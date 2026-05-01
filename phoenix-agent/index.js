/**
 * Phoenix Agent — Teleton Plugin for Phoenix
 *
 * Handles the on-chain execution layer of token migrations:
 * - Selling deposited OLDMEME into LP for TON extraction
 * - Building + hosting TEP-64 metadata JSON
 * - Launching NEWMEME on Groypad with extracted TON
 * - Discovering the new token address from the deploy TX
 * - Distributing NEWMEME to depositors
 * - Creating PHX/NEWMEME LP on DeDust
 *
 * Every step reports back to the Phoenix backend so the DB stays in sync.
 *
 * Groypad integration notes (reverse-engineered from on-chain):
 *   - MemeFactory: EQAO4cYqithwdltzmrlal1L5JKLK5Xk76feAJq0VoBC6Fy8T
 *   - Deploy opcode: 0x6ff416dc → MemeFactory (deploy + dev buy in one TX)
 *   - Deploy cell:   op(32) + qid(64) + flag:uint4(=4) + forward_amount:Coins + pad:uint2(=0) + ref[url_bytes]
 *   - Buy opcode:  0x742b36d8 → Meme (jetton master)
 *   - Factory fee:   0.5 TON flat (deducted from message value before bonding curve buy)
 *   - Graduation:  1,050 TON raised
 *   - Bonding curve: Virtual AMM (constant product) — NOT linear as docs simplify
 *   - Virtual reserves: alpha = virtual TON reserve, beta = virtual token reserve
 */

import {
  Factory,
  Asset,
  PoolType,
  VaultJetton,
  MAINNET_FACTORY_ADDR,
  ReadinessStatus,
} from '@dedust/sdk';
import { Address, toNano, TonClient4, beginCell } from '@ton/ton';

// Groypad constants
const MEME_FACTORY     = 'EQAO4cYqithwdltzmrlal1L5JKLK5Xk76feAJq0VoBC6Fy8T';
const DEPLOY_OPCODE    = 0x6ff416dc;
const BUY_OPCODE       = 0x742b36d8;
const DEPLOY_FLAG      = 4;
const FACTORY_FEE_TON  = 0.5;
const GRADUATION_TON   = 1050n * BigInt(1e9);
const TRADE_FEE_BPS    = 300;
const PRECISION        = BigInt(1e9);
const TONCENTER_V3     = 'https://toncenter.com/api/v3';
const TONAPI_V2        = 'https://tonapi.io/v2';
const BUY_GAS_TON      = 0.3;

// ── Backend helper ────────────────────────────────────────────────────────────

async function backendPost(backendUrl, path, body = {}, agentKey = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (agentKey) headers['X-Agent-Key'] = agentKey;
  const resp = await fetch(`${backendUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(`Backend ${path}: ${err.detail || resp.status}`);
  }
  return resp.json();
}

async function backendGet(backendUrl, path, agentKey = '') {
  const headers = {};
  if (agentKey) headers['X-Agent-Key'] = agentKey;
  const resp = await fetch(`${backendUrl}${path}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Backend GET ${path}: ${resp.status}`);
  return resp.json();
}

// ── Bonding curve math ────────────────────────────────────────────────────────

function integrateCurve(s1, s2, alpha, beta) {
  const dx = s2 - s1;
  if (dx <= 0n) return 0n;
  const term1 = (alpha * dx) / PRECISION;
  const term2 = (beta * dx * (s1 + s2)) / (2n * PRECISION * PRECISION);
  return term1 + term2;
}

function buyQuote(amountNano, currentSupply, alpha, beta) {
  const avgPrice = alpha + (beta * currentSupply) / PRECISION;
  if (avgPrice <= 0n) return 0n;
  let tokensOut = (amountNano * PRECISION) / avgPrice;
  for (let i = 0; i < 10; i++) {
    const cost = integrateCurve(currentSupply, currentSupply + tokensOut, alpha, beta);
    const diff = cost - amountNano;
    if (diff === 0n) break;
    const priceAtEnd = alpha + (beta * (currentSupply + tokensOut)) / PRECISION;
    if (priceAtEnd <= 0n) break;
    const adj = (diff * PRECISION) / priceAtEnd;
    tokensOut -= adj;
    if (tokensOut <= 0n) return 0n;
    if (adj > -2n && adj < 2n) break;
  }
  return tokensOut;
}

// ── TonCenter helper ──────────���──────────────────────────���────────────────────

async function runGetMethod(address, method, stack = [], apiKey) {
  const res = await fetch(`${TONCENTER_V3}/runGetMethod`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    },
    body: JSON.stringify({ address, method, stack }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`runGetMethod(${method}) failed: ${res.status}`);
  return res.json();
}

function stackBig(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  const s = String(v).trim();
  return s.startsWith('0x') || s.startsWith('-0x')
    ? BigInt(s.replace('-0x', '-'))
    : BigInt(s);
}

async function getMemeData(memeAddress, apiKey) {
  const result = await runGetMethod(memeAddress, 'get_meme_data', [], apiKey);
  const s = result.stack;
  return {
    initialized:    stackBig(s[0].value ?? s[0]) !== 0n,
    migrated:       stackBig(s[1].value ?? s[1]) !== 0n,
    isGraduated:    stackBig(s[6].value ?? s[6]) !== 0n,
    alpha:          stackBig(s[7].value ?? s[7]),
    beta:           stackBig(s[8].value ?? s[8]),
    tradeFeeBPS:    Number(stackBig(s[10].value ?? s[10])),
    raisedFunds:    stackBig(s[11].value ?? s[11]),
    currentSupply:  stackBig(s[12].value ?? s[12]),
  };
}

// ── TonAPI helper (for TX trace / address discovery) ──────────────────────────

async function tonApiGet(path, apiKey) {
  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const resp = await fetch(`${TONAPI_V2}${path}`, {
    headers,
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`TonAPI ${path}: ${resp.status}`);
  return resp.json();
}

// ══════════════════════════════════════════��═══════════════════════════════════
// Plugin exports
// ═══════════════════════════════════���════════════════════════════��═════════════

export const manifest = {
  name: 'phoenix-agent',
  version: '2.0.0',
  sdk: '>=0.8.0',
  description: 'Phoenix migration execution engine — fully automated pipeline',
};

export function tools(sdk) {
  return [
    sellOldTokenTool(sdk),
    buildMetadataTool(sdk),
    phoenixDeployOnGroypadTool(sdk),
    discoverTokenAddressTool(sdk),
    groypadTokenInfoTool(sdk),
    groypadGetQuoteTool(sdk),
    phoenixBuyOnGroypadTool(sdk),
    distributeNewTokenTool(sdk),
    claimCreatorFeesTool(sdk),
    nftAirdropTool(sdk),
    createLiquidityPoolTool(sdk),
    checkMigrationStatusTool(sdk),
    executeMigrationTool(sdk),
  ];
}

export async function start(sdk) {
  sdk.log.info('Phoenix Agent v2 ignited — fully automated pipeline ready');
}

// ══════���══════════════════════════════════════════════════════���════════════════
// Tool definitions
// ═══��═════════════════════════��════════════════════════════════════════════════

// ── 1. Sell old tokens on DEX ───────────���─────────────────────────────────────

function sellOldTokenTool(sdk) {
  return {
    name: 'phoenix_sell_old_token',
    description:
      'Sell all deposited OLDMEME tokens from the vault into the existing LP to extract TON. ' +
      'Uses best-price routing between STON.fi and DeDust. ' +
      'After selling, reports the extracted TON back to the Phoenix backend.',
    parameters: {
      type: 'object',
      properties: {
        migration_id: { type: 'string', description: 'Migration ID to report results to' },
        jetton_address: { type: 'string', description: 'The jetton master address of the old token' },
        amount: { type: 'number', description: 'Total amount of old tokens to sell' },
        min_ton_out: { type: 'number', description: 'Minimum acceptable TON output (slippage protection)' },
        backend_url: { type: 'string', default: 'http://localhost:8000' },
        agent_key: { type: 'string', description: 'API key for agent endpoints' },
      },
      required: ['migration_id', 'jetton_address', 'amount'],
    },
    execute: async ({ migration_id, jetton_address, amount, min_ton_out = 0, backend_url = 'http://localhost:8000', agent_key = '' }) => {
      try {
        // Update status to selling
        await backendPost(backend_url, `/api/migrations/${migration_id}/status`, { new_status: 'selling' }).catch(() => {});

        // Read actual wallet balance — never trust DB amount
        const walletBalance = await sdk.ton.getJettonBalance(jetton_address);
        const sellAmount = walletBalance > 0 ? walletBalance : amount;
        sdk.log.info(`Wallet holds ${walletBalance} tokens (DB says ${amount}). Selling ${sellAmount}`);

        if (sellAmount <= 0) {
          return { success: false, error: 'No tokens in wallet to sell' };
        }

        // Split into 4 trades to reduce price impact
        const NUM_TRADES = 4;
        const trancheSize = Math.floor(sellAmount / NUM_TRADES * 100) / 100; // truncate to 2 dp
        const lastTranche = Math.floor((sellAmount - trancheSize * (NUM_TRADES - 1)) * 100) / 100;
        let totalTonReceived = 0;

        for (let i = 0; i < NUM_TRADES; i++) {
          // Re-read wallet balance before each trade to prevent selling more than we have
          const currentBalance = await sdk.ton.getJettonBalance(jetton_address);
          sdk.log.info(`Trade ${i + 1}/${NUM_TRADES}: wallet balance = ${currentBalance}`);

          if (currentBalance <= 0) {
            sdk.log.info(`Wallet empty — stopping trades after ${i} of ${NUM_TRADES}`);
            break;
          }

          // For last trade or if balance is less than planned tranche, sell everything remaining
          const planned = i < NUM_TRADES - 1 ? trancheSize : lastTranche;
          const thisAmount = Math.min(planned, currentBalance);
          if (thisAmount <= 0) continue;

          sdk.log.info(`Trade ${i + 1}/${NUM_TRADES}: selling ${thisAmount} tokens (planned ${planned})...`);

          const quote = await sdk.ton.getSwapQuote(jetton_address, 'TON', thisAmount);
          if (!quote || quote.outAmount <= 0) {
            sdk.log.warn(`Trade ${i + 1}: no quote available, skipping`);
            continue;
          }
          sdk.log.info(`Trade ${i + 1}: quote ${quote.outAmount} TON via ${quote.dex}`);

          const result = await sdk.ton.swap(jetton_address, 'TON', thisAmount, {
            slippage: 0.50, // 50% slippage per trade
          });

          totalTonReceived += result.outAmount;
          sdk.log.info(`Trade ${i + 1}: received ${result.outAmount} TON (total: ${totalTonReceived.toFixed(4)} TON)`);

          // Brief pause between trades to let pool rebalance
          if (i < NUM_TRADES - 1) {
            await new Promise(r => setTimeout(r, 15000));
          }
        }

        const tonReceived = totalTonReceived;
        sdk.log.info(`All trades complete! Total received: ${tonReceived} TON`);

        // Report extraction to backend — transitions status to 'launching'
        const report = await backendPost(backend_url, `/api/migrations/${migration_id}/extracted-ton`, {
          extracted_ton: tonReceived,
          dev_buy_ton: tonReceived,
        }, agent_key);
        sdk.log.info(`Backend updated: extracted_ton=${tonReceived}, status=${report.status}`);

        return {
          success: true,
          ton_received: tonReceived,
          tx_hash: result.txHash,
          dex: result.dex,
          backend_status: report.status,
        };
      } catch (error) {
        sdk.log.error(`Sell failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  };
}

// ─��� 2. Build + host TEP-64 metadata JSON ───────────���──────────────────────────

function buildMetadataTool(sdk) {
  return {
    name: 'phoenix_build_metadata',
    description:
      'Build a TEP-64 metadata JSON from the migration\'s stored metadata and host it on the backend. ' +
      'Returns a metadata_url to pass to phoenix_deploy_on_groypad. ' +
      'If the migration already has metadata stored from the proposal form, call with just the migration_id.',
    parameters: {
      type: 'object',
      properties: {
        migration_id: { type: 'string', description: 'Migration ID' },
        name: { type: 'string', description: 'Override token name (optional)' },
        symbol: { type: 'string', description: 'Override token symbol (optional)' },
        description: { type: 'string', description: 'Override description (optional)' },
        image: { type: 'string', description: 'Override image URL (optional)' },
        socials: {
          type: 'object',
          properties: {
            telegram: { type: 'string' },
            twitter: { type: 'string' },
            website: { type: 'string' },
          },
        },
        backend_url: { type: 'string', default: 'http://localhost:8000' },
        agent_key: { type: 'string', description: 'API key for agent endpoints' },
      },
      required: ['migration_id'],
    },
    execute: async ({ migration_id, name, symbol, description, image, socials, backend_url = 'http://localhost:8000', agent_key = '' }) => {
      try {
        // If overrides provided, send them; otherwise backend uses stored metadata
        const body = {};
        if (name) body.name = name;
        if (symbol) body.symbol = symbol;
        if (description) body.description = description;
        if (image) body.image = image;
        if (socials) body.socials = socials;

        const hasOverrides = Object.keys(body).length > 0;
        const result = await backendPost(
          backend_url,
          `/api/migrations/${migration_id}/build-metadata`,
          hasOverrides ? body : undefined,
          agent_key,
        );

        // The URL is relative (/api/uploads/...) — make absolute for Groypad
        const metadataUrl = `${backend_url}${result.metadata_url}`;

        sdk.log.info(`Metadata built: ${metadataUrl}`);
        return {
          success: true,
          metadata_url: metadataUrl,
          metadata: result.metadata,
          filename: result.filename,
        };
      } catch (error) {
        sdk.log.error(`Metadata build failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  };
}

// ── 3. Deploy on Groypad ──────────────────────────────────────────────────────

/**
 * GROYPAD INTEGRATION — FULLY PROGRAMMATIC
 *
 * Deploy opcode 0x6ff416dc was reverse-engineered from on-chain MemeFactory transactions.
 * Deploy + dev buy happen in a SINGLE transaction to the MemeFactory contract.
 *
 * Deploy message layout (TL-B):
 *   op:uint32 (0x6ff416dc) + query_id:uint64 + flag:uint4 (=4) +
 *   forward_amount:Coins + pad:uint2 (=0) + ref[content_url_bytes]
 *
 * The message value = dev_buy_ton (the total TON to spend).
 * Factory deducts a flat 0.5 TON fee, forwards the rest to the bonding curve buy.
 * Content ref = raw URL bytes (factory wraps in TEP-64 0x01 prefix internally).
 */

function phoenixDeployOnGroypadTool(sdk) {
  return {
    name: 'phoenix_deploy_on_groypad',
    description:
      'Deploy a new token on Groypad and execute the dev buy in a single on-chain transaction. ' +
      'Sends TON to the MemeFactory contract (opcode 0x6ff416dc). The factory deploys the meme contract, ' +
      'deducts a flat 0.5 TON fee, and forwards the rest as the initial bonding curve buy. ' +
      'IMPORTANT: Call phoenix_build_metadata first to get the metadata_url.',
    parameters: {
      type: 'object',
      properties: {
        name:         { type: 'string', description: 'New token name' },
        symbol:       { type: 'string', description: 'New token ticker symbol' },
        dev_buy_ton:  {
          type: 'number',
          description: 'Total TON to spend (0.5 TON factory fee deducted automatically). 1050 TON = full graduation.',
        },
        metadata_url: {
          type: 'string',
          description: 'TEP-64 metadata JSON URL from phoenix_build_metadata.',
        },
      },
      required: ['name', 'symbol', 'dev_buy_ton', 'metadata_url'],
    },
    execute: async ({ name, symbol, dev_buy_ton, metadata_url }) => {
      sdk.log.info(`Deploying ${symbol} on Groypad | ${dev_buy_ton} TON dev buy | metadata: ${metadata_url}`);

      if (dev_buy_ton < 1) {
        return { success: false, error: 'Dev buy must be at least 1 TON (0.5 TON factory fee + 0.5 TON minimum buy).' };
      }

      try {
        const forwardAmountNano = BigInt(Math.floor((dev_buy_ton - FACTORY_FEE_TON) * 1e9));

        const contentCell = beginCell()
          .storeBuffer(Buffer.from(metadata_url))
          .endCell();

        const body = beginCell()
          .storeUint(DEPLOY_OPCODE, 32)
          .storeUint(0, 64)
          .storeUint(DEPLOY_FLAG, 4)
          .storeCoins(forwardAmountNano)
          .storeUint(0, 2)
          .storeRef(contentCell)
          .endCell();

        const txResult = await sdk.ton.sendTON(
          MEME_FACTORY,
          dev_buy_ton,
          body.toBoc().toString('base64'),
        );

        const netBuy = dev_buy_ton - FACTORY_FEE_TON;
        const graduatesPct = Math.min(100, (netBuy / 1050) * 100);

        sdk.log.info(`Deploy TX sent: ${txResult?.txRef} | net buy: ${netBuy} TON | grad: ${graduatesPct.toFixed(1)}%`);

        return {
          success: true,
          tx_ref: txResult?.txRef,
          factory: MEME_FACTORY,
          dev_buy_ton,
          factory_fee_ton: FACTORY_FEE_TON,
          net_buy_ton: netBuy,
          graduation_progress_pct: graduatesPct.toFixed(2),
          graduates: graduatesPct >= 100,
          metadata_url,
          note: 'Use phoenix_discover_token_address with the tx_ref to find the new meme contract address.',
        };
      } catch (error) {
        sdk.log.error(`Deploy failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  };
}

// ── 4. Discover new token address from deploy TX ──────��───────────────────────

function discoverTokenAddressTool(sdk) {
  return {
    name: 'phoenix_discover_token_address',
    description:
      'After deploying on Groypad, discover the new meme contract address by tracing the deploy transaction. ' +
      'Queries TonAPI for the transaction trace and finds the newly created contract. ' +
      'Also reports the deployment back to the Phoenix backend.',
    parameters: {
      type: 'object',
      properties: {
        tx_ref: { type: 'string', description: 'Transaction reference/hash from phoenix_deploy_on_groypad' },
        migration_id: { type: 'string', description: 'Migration ID to report the new address to' },
        dev_buy_ton: { type: 'number', description: 'TON spent on dev buy (for backend reporting)' },
        backend_url: { type: 'string', default: 'http://localhost:8000' },
        agent_key: { type: 'string', description: 'API key for agent endpoints' },
      },
      required: ['tx_ref', 'migration_id'],
    },
    execute: async ({ tx_ref, migration_id, dev_buy_ton, backend_url = 'http://localhost:8000', agent_key = '' }) => {
      const apiKey = sdk.secrets?.get?.('TON_API_KEY');
      sdk.log.info(`Discovering new token address from TX: ${tx_ref}`);

      try {
        // Wait a bit for the transaction to be indexed
        await new Promise(r => setTimeout(r, 10000));

        // Try to get the event/trace for this transaction
        const event = await tonApiGet(`/events/${tx_ref}`, apiKey);

        // Look for a JettonMint or contract deploy action in the trace
        let newTokenAddress = null;
        let agentSupply = 0;

        for (const action of event.actions || []) {
          // Look for JettonMint (factory creates new jetton)
          if (action.type === 'JettonMint' && action.status === 'ok') {
            const mint = action.JettonMint || {};
            newTokenAddress = mint.jetton?.address;
            const rawAmount = parseInt(mint.amount || '0');
            const decimals = parseInt(mint.jetton?.decimals || '9');
            agentSupply = rawAmount / (10 ** decimals);
            break;
          }

          // Also check for JettonTransfer from factory (deploy + buy results in transfer to deployer)
          if (action.type === 'JettonTransfer' && action.status === 'ok') {
            const transfer = action.JettonTransfer || {};
            const sender = transfer.sender?.address || '';
            // If the sender is the factory or a new contract, this is our token
            if (sender.toLowerCase() !== MEME_FACTORY.toLowerCase()) {
              newTokenAddress = transfer.jetton?.address;
              const rawAmount = parseInt(transfer.amount || '0');
              const decimals = parseInt(transfer.jetton?.decimals || '9');
              agentSupply = rawAmount / (10 ** decimals);
            }
          }
        }

        // Fallback: check the trace children for contract deploy
        if (!newTokenAddress && event.trace_id) {
          try {
            const trace = await tonApiGet(`/traces/${event.trace_id}`, apiKey);
            // Walk the trace tree for account_activated (new contract) or jetton operations
            const walkTrace = (node) => {
              if (!node) return;
              const tx = node.transaction || {};
              // New contract deploy shows as account_activated
              if (tx.account?.status === 'active' && tx.orig_status === 'nonexist') {
                // This is a newly created contract — likely our meme token
                const addr = tx.account?.address;
                if (addr && addr.toLowerCase() !== MEME_FACTORY.toLowerCase()) {
                  newTokenAddress = addr;
                }
              }
              for (const child of node.children || []) {
                walkTrace(child);
              }
            };
            walkTrace(trace);
          } catch (e) {
            sdk.log.warn(`Trace lookup failed: ${e.message}`);
          }
        }

        if (!newTokenAddress) {
          return {
            success: false,
            error: 'Could not find new token address in transaction trace. The TX may still be processing — try again in 30 seconds.',
            tx_ref,
          };
        }

        sdk.log.info(`Discovered new token: ${newTokenAddress} | agent_supply: ${agentSupply}`);

        // If we didn't get agent_supply from the event, read it from on-chain
        if (agentSupply <= 0) {
          try {
            const toncenterKey = sdk.secrets?.get?.('TONCENTER_API_KEY');
            const data = await getMemeData(newTokenAddress, toncenterKey);
            agentSupply = Number(data.currentSupply) / 1e9;
            sdk.log.info(`Read agent_supply from chain: ${agentSupply}`);
          } catch (e) {
            sdk.log.warn(`Could not read meme data: ${e.message}`);
          }
        }

        // Report to backend — transitions status to 'distributing'
        const report = await backendPost(backend_url, `/api/migrations/${migration_id}/deployed-token`, {
          new_token_address: newTokenAddress,
          agent_supply: agentSupply,
          dev_buy_ton: dev_buy_ton || undefined,
        }, agent_key);
        sdk.log.info(`Backend updated: new_token=${newTokenAddress}, status=${report.status}`);

        return {
          success: true,
          new_token_address: newTokenAddress,
          agent_supply: agentSupply,
          tx_ref,
          backend_status: report.status,
        };
      } catch (error) {
        sdk.log.error(`Token discovery failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  };
}

// ── 5. Groypad token info ───────────���─────────────────────────────────────────

function groypadTokenInfoTool(sdk) {
  return {
    name: 'groypad_token_info',
    description:
      'Get on-chain bonding curve state for a Groypad token: price, progress toward graduation, raised funds, supply.',
    parameters: {
      type: 'object',
      properties: {
        meme_address: { type: 'string', description: 'Groypad Meme contract address (jetton master)' },
      },
      required: ['meme_address'],
    },
    execute: async ({ meme_address }) => {
      const apiKey = sdk.secrets?.get?.('TONCENTER_API_KEY');
      try {
        const data = await getMemeData(meme_address, apiKey);
        const price = Number(data.alpha + (data.beta * data.currentSupply) / PRECISION) / 1e9;
        const progressPct = Math.min(100, Number((data.raisedFunds * 10000n) / GRADUATION_TON) / 100);
        return {
          success: true,
          meme_address,
          price_ton: price.toFixed(9),
          raised_ton: (Number(data.raisedFunds) / 1e9).toFixed(4),
          graduation_target_ton: '1050',
          progress_percent: progressPct.toFixed(2),
          current_supply: data.currentSupply.toString(),
          is_graduated: data.isGraduated,
          is_migrated: data.migrated,
          trade_fee_pct: (data.tradeFeeBPS / 100).toFixed(1),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };
}

// ── 6. Groypad buy quote ─────────────��───────────────────────���────────────────

function groypadGetQuoteTool(sdk) {
  return {
    name: 'groypad_get_quote',
    description: 'Preview how many tokens a given TON amount will buy on Groypad (no transaction sent).',
    parameters: {
      type: 'object',
      properties: {
        meme_address: { type: 'string', description: 'Groypad Meme contract address' },
        amount_ton: { type: 'number', description: 'TON to spend (excluding 0.3 TON gas)' },
        slippage: { type: 'number', description: 'Slippage % for min_tokens_out calculation (default 5)' },
      },
      required: ['meme_address', 'amount_ton'],
    },
    execute: async ({ meme_address, amount_ton, slippage = 5 }) => {
      const apiKey = sdk.secrets?.get?.('TONCENTER_API_KEY');
      try {
        const data = await getMemeData(meme_address, apiKey);
        if (data.migrated || data.isGraduated) {
          return { success: false, error: 'Token already graduated — trade on DEX, not bonding curve.' };
        }
        const amountNano = BigInt(Math.floor(amount_ton * 1e9));
        const tokensOut = buyQuote(amountNano, data.currentSupply, data.alpha, data.beta);
        const minTokensOut = (tokensOut * BigInt(100 - slippage)) / 100n;
        const currentPrice = Number(data.alpha + (data.beta * data.currentSupply) / PRECISION) / 1e9;
        const priceAfter = Number(data.alpha + (data.beta * (data.currentSupply + tokensOut)) / PRECISION) / 1e9;
        const priceImpact = currentPrice > 0 ? (((priceAfter - currentPrice) / currentPrice) * 100).toFixed(2) : '0';
        return {
          success: true,
          amount_ton,
          estimated_tokens: (Number(tokensOut) / 1e9).toFixed(4),
          min_tokens_out: (Number(minTokensOut) / 1e9).toFixed(4),
          current_price_ton: currentPrice.toFixed(9),
          price_after_ton: priceAfter.toFixed(9),
          price_impact_pct: priceImpact,
          total_to_send_ton: (amount_ton + BUY_GAS_TON).toFixed(3),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };
}

// ── 7. Buy on Groypad (additional buys after deploy) ──────────────────────────

function phoenixBuyOnGroypadTool(sdk) {
  return {
    name: 'phoenix_buy_on_groypad',
    description:
      'Execute a buy on an already-deployed Groypad token. ' +
      'Sends TON to the Meme contract with opcode 0x742b36d8. ' +
      'Used for additional buys after the initial deploy, or for community top-up buys.',
    parameters: {
      type: 'object',
      properties: {
        meme_address: { type: 'string', description: 'Groypad Meme contract address (jetton master)' },
        amount_ton: { type: 'number', description: 'TON to spend on the buy. 0.3 TON gas added automatically.' },
        slippage: { type: 'number', description: 'Slippage % for min_tokens_out (default 5)' },
      },
      required: ['meme_address', 'amount_ton'],
    },
    execute: async ({ meme_address, amount_ton, slippage = 5 }) => {
      const apiKey = sdk.secrets?.get?.('TONCENTER_API_KEY');
      sdk.log.info(`Phoenix buy: ${amount_ton} TON -> ${meme_address}`);

      try {
        const data = await getMemeData(meme_address, apiKey);

        if (data.migrated) return { success: false, error: 'Token already migrated to DEX — bonding curve is closed.' };
        if (data.isGraduated) return { success: false, error: 'Token is graduating — wait for DEX migration.' };

        const amountNano = BigInt(Math.floor(amount_ton * 1e9));
        const tokensOut = buyQuote(amountNano, data.currentSupply, data.alpha, data.beta);
        const minOut = (tokensOut * BigInt(100 - slippage)) / 100n;
        const totalValue = amount_ton + BUY_GAS_TON;

        sdk.log.info(`Quote: ${(Number(tokensOut) / 1e9).toFixed(4)} tokens | min_out: ${(Number(minOut) / 1e9).toFixed(4)} | total: ${totalValue} TON`);

        const body = beginCell()
          .storeUint(BUY_OPCODE, 32)
          .storeUint(0, 64)
          .storeCoins(minOut)
          .endCell();

        const txResult = await sdk.ton.sendTON(meme_address, totalValue, body.toBoc().toString('base64'));

        const progressAfter = Math.min(100, Number(((data.raisedFunds + amountNano) * 10000n) / GRADUATION_TON) / 100);

        sdk.log.info(`Buy tx sent: ${txResult?.txRef}`);

        return {
          success: true,
          meme_address,
          amount_ton,
          total_sent_ton: totalValue,
          estimated_tokens: (Number(tokensOut) / 1e9).toFixed(4),
          tx_ref: txResult?.txRef,
          graduation_progress_after_pct: progressAfter.toFixed(2),
          graduates: progressAfter >= 100,
        };
      } catch (error) {
        sdk.log.error(`Buy failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  };
}

// ── 8. Distribute new tokens ──────────────────────────────────────────────────

function distributeNewTokenTool(sdk) {
  return {
    name: 'phoenix_distribute_tokens',
    description:
      'Distribute NEWMEME tokens to all depositors. ' +
      'First calls the backend to generate distribution records (execute-distributions), ' +
      'then sends jetton transfers and marks each as completed in the backend.',
    parameters: {
      type: 'object',
      properties: {
        migration_id: { type: 'string', description: 'Migration ID' },
        jetton_address: { type: 'string', description: 'New token jetton master address' },
        batch_size: { type: 'number', description: 'Number of transfers per batch (default 50)' },
        backend_url: { type: 'string', default: 'http://localhost:8000' },
        agent_key: { type: 'string', description: 'API key for agent endpoints' },
      },
      required: ['migration_id', 'jetton_address'],
    },
    execute: async ({ migration_id, jetton_address, batch_size = 50, backend_url = 'http://localhost:8000', agent_key = '' }) => {
      sdk.log.info(`Starting distribution for migration ${migration_id}`);

      try {
        // Step 1: Tell backend to calculate and persist distribution records
        sdk.log.info('Executing distributions on backend...');
        let distResult;
        try {
          distResult = await backendPost(backend_url, `/api/migrations/${migration_id}/execute-distributions`, {}, agent_key);
        } catch (e) {
          // 409 = already executed — fetch existing
          if (e.message.includes('409')) {
            sdk.log.info('Distributions already executed — fetching existing records');
          } else {
            throw e;
          }
        }

        // Step 2: Fetch the distribution records
        const distData = await backendGet(backend_url, `/api/migrations/${migration_id}/distributions-executed`, agent_key);
        const pending = distData.distributions.filter(d => d.status === 'pending');

        if (pending.length === 0) {
          sdk.log.info('No pending distributions — all already completed');
          return { success: true, total: distData.total_distributions, sent: 0, already_completed: distData.completed };
        }

        sdk.log.info(`${pending.length} pending distributions to send`);

        // Step 3: Send jetton transfers in batches
        const results = { sent: 0, failed: 0, errors: [], txMap: [] };

        for (let i = 0; i < pending.length; i += batch_size) {
          const batch = pending.slice(i, i + batch_size);

          for (const dist of batch) {
            try {
              const txResult = await sdk.ton.transferJetton(
                jetton_address,
                dist.wallet_address,
                dist.newmeme_total,
              );
              results.sent++;
              results.txMap.push({
                wallet_address: dist.wallet_address,
                tx_hash: txResult?.txHash || txResult?.txRef || `batch_${i}_${results.sent}`,
              });
            } catch (error) {
              results.failed++;
              results.errors.push({ wallet: dist.wallet_address, error: error.message });
              sdk.log.warn(`Failed to send to ${dist.wallet_address}: ${error.message}`);
            }
          }

          sdk.log.info(`Batch ${Math.floor(i / batch_size) + 1}: ${results.sent} sent, ${results.failed} failed`);

          // Mark completed batch in backend
          if (results.txMap.length > 0) {
            try {
              await backendPost(backend_url, `/api/migrations/${migration_id}/distributions-mark-sent`, {
                distributions: results.txMap,
              }, agent_key);
              results.txMap = []; // Reset after successful report
            } catch (e) {
              sdk.log.warn(`Failed to mark batch as sent: ${e.message}`);
            }
          }

          if (i + batch_size < pending.length) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        // Mark any remaining
        if (results.txMap.length > 0) {
          try {
            await backendPost(backend_url, `/api/migrations/${migration_id}/distributions-mark-sent`, {
              distributions: results.txMap,
            });
          } catch (e) {
            sdk.log.warn(`Failed to mark final batch: ${e.message}`);
          }
        }

        return {
          success: results.failed === 0,
          total: pending.length,
          sent: results.sent,
          failed: results.failed,
          errors: results.errors.slice(0, 10),
        };
      } catch (error) {
        sdk.log.error(`Distribution failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  };
}

// ── 8b. Claim creator fees via GroypFi bot ───────────────────────────────────

const FEECLAIM_BOT = 'feeclaim_bot';

function claimCreatorFeesTool(sdk) {
  return {
    name: 'phoenix_claim_creator_fees',
    description:
      'Transfer Groypad creator fees to the community wallet by sending a /claim command to the GroypFi fee claim bot on Telegram. ' +
      'Requires the launcher wallet address (Agent wallet), token ticker, and new contract address. ' +
      'The bot will reassign creator fee earnings to the specified community wallet.',
    parameters: {
      type: 'object',
      properties: {
        creator_fee_wallet: { type: 'string', description: 'Community wallet that should receive creator fees' },
        ticker: { type: 'string', description: 'Token ticker/symbol (e.g. PHX)' },
        new_token_address: { type: 'string', description: 'Deployed Groypad meme contract address' },
        migration_id: { type: 'string', description: 'Migration ID (for backend reporting)' },
        backend_url: { type: 'string', default: 'http://localhost:8000' },
        agent_key: { type: 'string', description: 'API key for agent endpoints' },
      },
      required: ['creator_fee_wallet', 'ticker', 'new_token_address'],
    },
    execute: async ({ creator_fee_wallet, ticker, new_token_address, migration_id, backend_url = 'http://localhost:8000', agent_key = '' }) => {
      sdk.log.info(`Claiming creator fees → ${creator_fee_wallet} for ${ticker} (${new_token_address})`);

      try {
        // Send /claim command to the GroypFi fee claim bot
        // Format: /claim then on next prompt: WALLET_ADDRESS TICKER CONTRACT_ADDRESS
        const claimMessage = `${creator_fee_wallet} ${ticker} ${new_token_address}`;

        // First send /claim to initiate the flow
        await sdk.telegram.sendMessage(FEECLAIM_BOT, '/claim');
        sdk.log.info('Sent /claim to @feeclaim_bot');

        // Wait for the bot to respond with its prompt
        await new Promise(r => setTimeout(r, 3000));

        // Send the claim details
        await sdk.telegram.sendMessage(FEECLAIM_BOT, claimMessage);
        sdk.log.info(`Sent claim details: ${claimMessage}`);

        // Update backend with the creator fee wallet
        if (migration_id) {
          try {
            await backendPost(backend_url, `/api/migrations/${migration_id}/creator-reward`, {
              wallet: creator_fee_wallet,
            }, agent_key);
            sdk.log.info(`Backend updated: creator_reward_wallet → ${creator_fee_wallet}`);
          } catch (e) {
            sdk.log.warn(`Backend creator-reward update failed: ${e.message}`);
          }
        }

        return {
          success: true,
          creator_fee_wallet,
          ticker,
          new_token_address,
          bot: `@${FEECLAIM_BOT}`,
          note: 'Fee claim submitted to GroypFi bot. Creator fees will be redirected to the community wallet.',
        };
      } catch (error) {
        sdk.log.error(`Fee claim failed: ${error.message}`);
        return {
          success: false,
          error: error.message,
          manual_claim: {
            bot: `@${FEECLAIM_BOT}`,
            command: '/claim',
            details: `${creator_fee_wallet} ${ticker} ${new_token_address}`,
            note: 'Automatic claim failed. Submit this manually to the bot.',
          },
        };
      }
    },
  };
}

// ── Treasury constants ───────────────────────────────────────────────────────

const TREASURY_LP_SEED_AMOUNT     = 5_000_000;   // 0.5% of 1B supply
const TREASURY_NFT_AIRDROP_AMOUNT = 5_000_000;   // 0.5% of 1B supply
const GROYPER_AIRDROP_PER_NFT     = 18_450;       // 5M / 271

// ── 8c. NFT airdrop tool ────────────────────────────────────────────────────

function nftAirdropTool(sdk) {
  return {
    name: 'phoenix_nft_airdrop',
    description:
      'Airdrop 0.5% of NEWTOKEN supply (5,000,000 tokens) to Groyper NFT holders. ' +
      'Each NFT earns 18,450 tokens. Takes a snapshot of NFT holders, creates airdrop records ' +
      'in the backend, then sends jetton transfers and marks them as completed.',
    parameters: {
      type: 'object',
      properties: {
        migration_id: { type: 'string', description: 'Migration ID' },
        jetton_address: { type: 'string', description: 'New token jetton master address' },
        backend_url: { type: 'string', default: 'http://localhost:8000' },
        agent_key: { type: 'string', description: 'API key for agent endpoints' },
      },
      required: ['migration_id', 'jetton_address'],
    },
    execute: async ({ migration_id, jetton_address, backend_url = 'http://localhost:8000', agent_key = '' }) => {
      sdk.log.info(`Starting NFT airdrop for migration ${migration_id}`);

      try {
        // Step 1: Take NFT holder snapshot on backend
        sdk.log.info('Taking NFT holder snapshot...');
        let snapshotResult;
        try {
          snapshotResult = await backendPost(backend_url, `/api/migrations/${migration_id}/nft-airdrop-snapshot`, {}, agent_key);
        } catch (e) {
          if (e.message.includes('409')) {
            sdk.log.info('NFT snapshot already taken — fetching existing records');
          } else {
            throw e;
          }
        }

        // Step 2: Fetch airdrop records
        const airdropData = await backendGet(backend_url, `/api/migrations/${migration_id}/nft-airdrops`, agent_key);
        const pending = airdropData.airdrops.filter(a => a.status === 'pending');

        if (pending.length === 0) {
          sdk.log.info('No pending NFT airdrops');
          return { success: true, total: airdropData.total_holders, sent: 0, already_completed: airdropData.completed };
        }

        sdk.log.info(`${pending.length} NFT holders to airdrop to`);

        // Step 3: Send jetton transfers
        const results = { sent: 0, failed: 0, errors: [], txMap: [] };

        for (const airdrop of pending) {
          try {
            const txResult = await sdk.ton.transferJetton(
              jetton_address,
              airdrop.wallet_address,
              airdrop.airdrop_amount,
            );
            results.sent++;
            results.txMap.push({
              wallet_address: airdrop.wallet_address,
              tx_hash: txResult?.txHash || txResult?.txRef || `nft_airdrop_${results.sent}`,
            });
          } catch (error) {
            results.failed++;
            results.errors.push({ wallet: airdrop.wallet_address, error: error.message });
            sdk.log.warn(`NFT airdrop failed for ${airdrop.wallet_address}: ${error.message}`);
          }
        }

        // Step 4: Mark completed in backend
        if (results.txMap.length > 0) {
          try {
            await backendPost(backend_url, `/api/migrations/${migration_id}/nft-airdrops-mark-sent`, {
              airdrops: results.txMap,
            }, agent_key);
          } catch (e) {
            sdk.log.warn(`Failed to mark NFT airdrops as sent: ${e.message}`);
          }
        }

        sdk.log.info(`NFT airdrop complete: ${results.sent} sent, ${results.failed} failed`);

        return {
          success: results.failed === 0,
          total_holders: pending.length,
          sent: results.sent,
          failed: results.failed,
          total_tokens: results.sent * GROYPER_AIRDROP_PER_NFT,
          errors: results.errors.slice(0, 10),
        };
      } catch (error) {
        sdk.log.error(`NFT airdrop failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  };
}

// ── Price lookup helper (for USD-matched LP seeding) ─────────────────────────

async function getTokenPriceInTon(jettonAddress, apiKey) {
  /**
   * Get the current spot price of a jetton in TON.
   * Queries TonAPI rates endpoint first, falls back to pool reserves.
   */
  try {
    const resp = await fetch(`${TONAPI_V2}/rates?tokens=${jettonAddress}&currencies=ton`, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const rates = data.rates?.[jettonAddress]?.prices;
      if (rates?.TON) return parseFloat(rates.TON);
    }
  } catch (_) {}

  // Fallback: check DeDust/STON.fi pools via backend
  return null;
}

async function getTonUsdPrice() {
  /**
   * Get current TON/USD price from TonAPI rates.
   */
  try {
    const resp = await fetch(`${TONAPI_V2}/rates?tokens=ton&currencies=usd`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return parseFloat(data.rates?.TON?.prices?.USD || '0');
    }
  } catch (_) {}
  return 0;
}

// ── 9. Create LP on DeDust ────────────────────────────────────────────────────

function createLiquidityPoolTool(sdk) {
  return {
    name: 'phoenix_create_lp',
    description:
      'Create a PHX/NEWTOKEN liquidity pool on DeDust. Deposits both jettons into a new volatile pool.',
    parameters: {
      type: 'object',
      properties: {
        phoenix_address: { type: 'string', description: 'PHX jetton master address' },
        new_token_address: { type: 'string', description: 'New migrated token jetton master address' },
        phoenix_amount: { type: 'number', description: 'Amount of PHX to add to LP (human units)' },
        new_token_amount: { type: 'number', description: 'Amount of new token to add to LP (human units)' },
        phoenix_decimals: { type: 'number', description: 'PHX token decimals (default 9)' },
        new_token_decimals: { type: 'number', description: 'New token decimals (default 9)' },
        ton_rpc_url: { type: 'string', default: 'https://mainnet-v4.tonhubapi.com' },
      },
      required: ['phoenix_address', 'new_token_address', 'phoenix_amount', 'new_token_amount'],
    },
    execute: async ({
      phoenix_address, new_token_address,
      phoenix_amount, new_token_amount,
      phoenix_decimals = 9, new_token_decimals = 9,
      ton_rpc_url = 'https://mainnet-v4.tonhubapi.com',
    }) => {
      sdk.log.info(`Creating DeDust LP: ${phoenix_amount} PHX + ${new_token_amount} NEWTOKEN`);

      try {
        const tonClient = new TonClient4({ endpoint: ton_rpc_url });
        const factory = tonClient.open(Factory.createFromAddress(MAINNET_FACTORY_ADDR));

        const phxAsset = Asset.jetton(Address.parse(phoenix_address));
        const newTokenAsset = Asset.jetton(Address.parse(new_token_address));

        const pool = tonClient.open(
          await factory.getPool(PoolType.VOLATILE, [phxAsset, newTokenAsset])
        );

        const readiness = await pool.getReadinessStatus();
        if (readiness === ReadinessStatus.NOT_DEPLOYED) {
          sdk.log.info('Pool not deployed — creating via factory...');
          await factory.sendCreateVolatilePool(sdk.ton.sender, {
            assets: [phxAsset, newTokenAsset],
          });
          sdk.log.info('Pool creation tx sent — waiting for deployment...');
          for (let i = 0; i < 12; i++) {
            await new Promise(r => setTimeout(r, 5000));
            const status = await pool.getReadinessStatus();
            if (status !== ReadinessStatus.NOT_DEPLOYED) break;
          }
        }

        const phxVault = tonClient.open(await factory.getJettonVault(Address.parse(phoenix_address)));
        const newTokenVault = tonClient.open(await factory.getJettonVault(Address.parse(new_token_address)));

        const phxNano = toNano(phoenix_amount.toFixed(phoenix_decimals > 0 ? phoenix_decimals : 9));
        const newTokenNano = toNano(new_token_amount.toFixed(new_token_decimals > 0 ? new_token_decimals : 9));
        const poolAddress = pool.address.toString();

        sdk.log.info(`Pool address: ${poolAddress}`);

        sdk.log.info(`Depositing ${phoenix_amount} PHX into DeDust vault...`);
        await sdk.ton.sendJettonTransfer({
          jettonMaster: phoenix_address,
          to: phxVault.address.toString(),
          amount: phxNano,
          forwardPayload: VaultJetton.buildDepositLiquidityPayload({
            poolType: PoolType.VOLATILE,
            assets: [phxAsset, newTokenAsset],
            minimalLpAmount: 1n,
            targetBalances: [phxNano, newTokenNano],
          }),
          forwardAmount: toNano('0.5'),
          queryId: BigInt(Date.now()),
        });

        sdk.log.info(`Depositing ${new_token_amount} NEWTOKEN into DeDust vault...`);
        await sdk.ton.sendJettonTransfer({
          jettonMaster: new_token_address,
          to: newTokenVault.address.toString(),
          amount: newTokenNano,
          forwardPayload: VaultJetton.buildDepositLiquidityPayload({
            poolType: PoolType.VOLATILE,
            assets: [phxAsset, newTokenAsset],
            minimalLpAmount: 1n,
            targetBalances: [phxNano, newTokenNano],
          }),
          forwardAmount: toNano('0.5'),
          queryId: BigInt(Date.now() + 1),
        });

        sdk.log.info(`LP creation complete — pool: ${poolAddress}`);
        return {
          success: true,
          pool_address: poolAddress,
          phoenix_deposited: phoenix_amount,
          new_token_deposited: new_token_amount,
          dex: 'dedust',
        };
      } catch (error) {
        sdk.log.error(`LP creation failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  };
}

// ── 10. Check migration status ────────────────────────────────────────────────

function checkMigrationStatusTool(sdk) {
  return {
    name: 'phoenix_check_migration',
    description: 'Check the current status of a migration from the Phoenix backend.',
    parameters: {
      type: 'object',
      properties: {
        migration_id: { type: 'string', description: 'Migration ID' },
        backend_url: { type: 'string', default: 'http://localhost:8000' },
        agent_key: { type: 'string', description: 'API key for agent endpoints' },
      },
      required: ['migration_id'],
    },
    execute: async ({ migration_id, backend_url = 'http://localhost:8000', agent_key = '' }) => {
      try {
        return await backendGet(backend_url, `/api/migrations/${migration_id}`);
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };
}

// ── 11. Full migration pipeline ───────────────────────────────────────────────

function executeMigrationTool(sdk) {
  return {
    name: 'phoenix_execute_migration',
    description:
      'Execute the FULL migration pipeline end-to-end. This is the main orchestrator that: ' +
      '1) Sells OLDMEME on DEX for TON, 2) Builds metadata, 3) Deploys NEWMEME on Groypad, ' +
      '4) Discovers the new token address, 5) Distributes NEWMEME to depositors, ' +
      '6) Creates PHX/NEWTOKEN LP on DeDust (0.5% of supply, PHX amount auto-matched by USD value). ' +
      '7) Airdrops 0.5% of supply to Groyper NFT holders (18,450 tokens per NFT). ' +
      'All steps report back to the backend. Requires the migration to be in "qualified" status.',
    parameters: {
      type: 'object',
      properties: {
        migration_id: { type: 'string' },
        phoenix_token_address: { type: 'string', description: 'PHX jetton master address (for LP creation)' },
        backend_url: { type: 'string', default: 'http://localhost:8000' },
        agent_key: { type: 'string', description: 'API key for agent endpoints' },
      },
      required: ['migration_id'],
    },
    execute: async ({
      migration_id,
      phoenix_token_address,
      backend_url = 'http://localhost:8000',
      agent_key = '',
    }) => {
      sdk.log.info(`=== PHOENIX MIGRATION PIPELINE: ${migration_id} ===`);

      const steps = [];
      const fail = (step, error) => {
        steps.push({ step, status: 'failed', error });
        return { success: false, migration_id, steps, error: `Failed at ${step}: ${error}` };
      };

      try {
        // ── Step 1: Fetch migration details ───────────────────────────────
        sdk.log.info('Step 1: Fetching migration details...');
        const migration = await backendGet(backend_url, `/api/migrations/${migration_id}`);

        if (!['qualified', 'selling'].includes(migration.status)) {
          return fail('fetch_details', `Migration status is "${migration.status}" — must be "qualified" or "selling" to execute.`);
        }

        steps.push({
          step: 'fetch_details',
          status: 'complete',
          old_token: migration.old_token.address,
          total_deposited: migration.total_deposited,
        });

        // ── Step 2: Sell old tokens on DEX ────────────��───────────────────
        sdk.log.info(`Step 2: Selling ${migration.total_deposited} ${migration.old_token.symbol} on DEX...`);
        const sellTool = tools(sdk).find(t => t.name === 'phoenix_sell_old_token');
        const sellResult = await sellTool.execute({
          migration_id,
          jetton_address: migration.old_token.address,
          amount: migration.total_deposited,
          backend_url,
          agent_key,
        });

        if (!sellResult.success) return fail('sell_old_token', sellResult.error);

        const tonReceived = sellResult.ton_received;
        steps.push({ step: 'sell_old_token', status: 'complete', ton_received: tonReceived });

        // ── Step 3: Build metadata ────────────────────────────────────────
        sdk.log.info('Step 3: Building TEP-64 metadata...');
        const metaTool = tools(sdk).find(t => t.name === 'phoenix_build_metadata');
        const metaResult = await metaTool.execute({ migration_id, backend_url, agent_key });

        if (!metaResult.success) return fail('build_metadata', metaResult.error);

        steps.push({ step: 'build_metadata', status: 'complete', metadata_url: metaResult.metadata_url });

        // ── Step 4: Deploy on Groypad ─────────���───────────────────────────
        const newTokenName = migration.new_token?.name || `${migration.old_token.name} Reborn`;
        const newTokenSymbol = migration.new_token?.symbol || migration.old_token.symbol;

        sdk.log.info(`Step 4: Deploying ${newTokenSymbol} on Groypad with ${tonReceived} TON...`);
        const deployTool = tools(sdk).find(t => t.name === 'phoenix_deploy_on_groypad');
        const deployResult = await deployTool.execute({
          name: newTokenName,
          symbol: newTokenSymbol,
          dev_buy_ton: tonReceived,
          metadata_url: metaResult.metadata_url,
        });

        if (!deployResult.success) return fail('deploy_on_groypad', deployResult.error);

        steps.push({
          step: 'deploy_on_groypad',
          status: 'complete',
          tx_ref: deployResult.tx_ref,
          graduates: deployResult.graduates,
        });

        // ── Step 5: Discover new token address ────────────────────────────
        sdk.log.info('Step 5: Discovering new token address from deploy TX...');
        const discoverTool = tools(sdk).find(t => t.name === 'phoenix_discover_token_address');
        const discoverResult = await discoverTool.execute({
          tx_ref: deployResult.tx_ref,
          migration_id,
          dev_buy_ton: tonReceived,
          backend_url,
          agent_key,
        });

        if (!discoverResult.success) {
          // Retry once after waiting longer
          sdk.log.info('First discovery attempt failed — retrying in 30s...');
          await new Promise(r => setTimeout(r, 30000));
          const retry = await discoverTool.execute({
            tx_ref: deployResult.tx_ref,
            migration_id,
            dev_buy_ton: tonReceived,
            backend_url,
            agent_key,
          });
          if (!retry.success) return fail('discover_token', retry.error);
          Object.assign(discoverResult, retry);
        }

        const newTokenAddress = discoverResult.new_token_address;
        steps.push({
          step: 'discover_token',
          status: 'complete',
          new_token_address: newTokenAddress,
          agent_supply: discoverResult.agent_supply,
        });

        // ── Step 5b: Claim creator fees for community ─────────────────────
        if (migration.creator_fee_wallet) {
          sdk.log.info(`Step 5b: Claiming creator fees → ${migration.creator_fee_wallet}...`);
          const claimTool = tools(sdk).find(t => t.name === 'phoenix_claim_creator_fees');
          const claimResult = await claimTool.execute({
            creator_fee_wallet: migration.creator_fee_wallet,
            ticker: newTokenSymbol,
            new_token_address: newTokenAddress,
            migration_id,
            backend_url,
            agent_key,
          });

          if (claimResult.success) {
            steps.push({ step: 'claim_creator_fees', status: 'complete', wallet: migration.creator_fee_wallet });
          } else {
            // Non-fatal — log the manual fallback but continue the pipeline
            sdk.log.warn(`Creator fee claim failed — manual claim needed: ${claimResult.error}`);
            steps.push({
              step: 'claim_creator_fees',
              status: 'manual_needed',
              error: claimResult.error,
              manual_claim: claimResult.manual_claim,
            });
          }
        } else {
          steps.push({ step: 'claim_creator_fees', status: 'skipped', reason: 'No creator_fee_wallet set on migration' });
        }

        // ── Step 6: Distribute new tokens ─────────────────────────────────
        sdk.log.info(`Step 6: Distributing ${newTokenSymbol} to depositors...`);
        const distTool = tools(sdk).find(t => t.name === 'phoenix_distribute_tokens');
        const distResult = await distTool.execute({
          migration_id,
          jetton_address: newTokenAddress,
          backend_url,
          agent_key,
        });

        if (!distResult.success) return fail('distribute', distResult.error);

        steps.push({
          step: 'distribute',
          status: 'complete',
          sent: distResult.sent,
          failed: distResult.failed,
        });

        // ── Step 7: NFT airdrop (0.5% of supply to Groyper NFT holders) ──
        sdk.log.info('Step 7: Airdropping NEWTOKEN to Groyper NFT holders...');
        const airdropTool = tools(sdk).find(t => t.name === 'phoenix_nft_airdrop');
        const airdropResult = await airdropTool.execute({
          migration_id,
          jetton_address: newTokenAddress,
          backend_url,
          agent_key,
        });

        if (airdropResult.success) {
          steps.push({
            step: 'nft_airdrop',
            status: 'complete',
            holders: airdropResult.total_holders,
            tokens_sent: airdropResult.total_tokens,
          });
        } else {
          // Non-fatal — log but continue
          sdk.log.warn(`NFT airdrop failed: ${airdropResult.error}`);
          steps.push({ step: 'nft_airdrop', status: 'failed', error: airdropResult.error });
        }

        // ── Step 8: Seed PHX/NEWTOKEN LP (0.5% of supply, USD-matched) ───
        if (phoenix_token_address) {
          sdk.log.info('Step 8: Seeding PHX/NEWTOKEN LP on DeDust...');
          const apiKey = sdk.secrets?.get?.('TON_API_KEY');

          try {
            // Get NEWTOKEN price in TON (just launched, should have DEX price)
            const newTokenPrice = await getTokenPriceInTon(newTokenAddress, apiKey);
            const phxPrice = await getTokenPriceInTon(phoenix_token_address, apiKey);

            if (!newTokenPrice || !phxPrice || phxPrice <= 0) {
              sdk.log.warn('Could not fetch token prices for LP calculation');
              steps.push({
                step: 'seed_lp',
                status: 'skipped',
                reason: `Price lookup failed — newtoken_price=${newTokenPrice}, phx_price=${phxPrice}`,
              });
            } else {
              // Calculate: USD value of 5M NEWTOKEN, then equivalent PHX amount
              const lpNewTokenAmount = TREASURY_LP_SEED_AMOUNT;
              const newTokenValueTon = lpNewTokenAmount * newTokenPrice;
              const phxAmountNeeded = newTokenValueTon / phxPrice;

              sdk.log.info(
                `LP seed: ${lpNewTokenAmount} NEWTOKEN (${newTokenValueTon.toFixed(2)} TON) ` +
                `+ ${phxAmountNeeded.toFixed(2)} PHX (${newTokenValueTon.toFixed(2)} TON)`
              );

              const lpTool = tools(sdk).find(t => t.name === 'phoenix_create_lp');
              const lpResult = await lpTool.execute({
                phoenix_address: phoenix_token_address,
                new_token_address: newTokenAddress,
                phoenix_amount: phxAmountNeeded,
                new_token_amount: lpNewTokenAmount,
              });

              if (lpResult.success) {
                steps.push({
                  step: 'seed_lp',
                  status: 'complete',
                  pool_address: lpResult.pool_address,
                  newtoken_amount: lpNewTokenAmount,
                  phx_amount: phxAmountNeeded,
                });
              } else {
                steps.push({ step: 'seed_lp', status: 'failed', error: lpResult.error });
              }
            }
          } catch (lpError) {
            sdk.log.warn(`LP seeding failed: ${lpError.message}`);
            steps.push({ step: 'seed_lp', status: 'failed', error: lpError.message });
          }
        } else {
          steps.push({ step: 'seed_lp', status: 'skipped', reason: 'PHX token address not provided' });
        }

        // ── Done ──────────────────────────────────────────────────────────
        sdk.log.info(`=== MIGRATION ${migration_id} COMPLETE ===`);

        return {
          success: true,
          migration_id,
          new_token_address: newTokenAddress,
          ton_extracted: tonReceived,
          agent_supply: discoverResult.agent_supply,
          distributions_sent: distResult.sent,
          nft_airdrop_sent: airdropResult.success ? airdropResult.sent : 0,
          steps,
        };

      } catch (error) {
        sdk.log.error(`Pipeline error: ${error.message}`);
        return { success: false, error: error.message, steps };
      }
    },
  };
}
