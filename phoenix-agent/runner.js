/**
 * Phoenix Agent — Standalone Runner
 * ==================================
 * Polls the Phoenix backend every 30s for migrations in "selling" status
 * and executes the full migration pipeline autonomously.
 *
 * Implements the sdk.ton.* interface that the Teleton plugin tools expect,
 * using @ton/ton + @ton/crypto for wallet signing and @dedust/sdk for swaps.
 *
 * Environment variables:
 *   BACKEND_URL              — Phoenix backend (default: http://backend.railway.internal:8000)
 *   PHOENIX_AGENT_API_KEY    — Agent API key for authenticated endpoints
 *   PHOENIX_AGENT_MNEMONIC   — 24-word mnemonic for the agent wallet
 *   PHOENIX_TOKEN_ADDRESS    — PHX jetton master address (for LP seeding)
 *   TON_API_KEY              — TonAPI key (for token discovery, price lookups)
 *   TONCENTER_API_KEY        — TonCenter key (for contract get methods)
 *   TON_RPC_URL              — TonCenter JSON-RPC endpoint
 */

import { TonClient, WalletContractV5R1, internal, toNano, beginCell, Address, SendMode } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import {
  Factory,
  Asset,
  PoolType,
  VaultJetton,
  MAINNET_FACTORY_ADDR,
} from '@dedust/sdk';
import { DEX, pTON, dexFactory } from '@ston-fi/sdk';
import { StonApiClient } from '@ston-fi/api';
import { Address as AddressCore } from '@ton/core';
import { tools, manifest } from './index.js';

const stonApi = new StonApiClient();

// ── Config ───────────────────────────────────────────────────────────────────

const BACKEND_URL     = process.env.BACKEND_URL || 'http://backend.railway.internal:8000';
const AGENT_KEY       = process.env.PHOENIX_AGENT_API_KEY || '';
const MNEMONIC        = process.env.PHOENIX_AGENT_MNEMONIC || '';
const PHX_ADDRESS     = process.env.PHOENIX_TOKEN_ADDRESS || '';
const TON_API_KEY     = process.env.TON_API_KEY || '';
const TONCENTER_KEY   = process.env.TONCENTER_API_KEY || '';
const TON_RPC_URL     = process.env.TON_RPC_URL || 'https://toncenter.com/api/v2/jsonRPC';
const POLL_INTERVAL   = 30_000; // 30 seconds

// Track migrations currently being executed to prevent double-runs
const _executing = new Set();
// Cooldown after failures — wait 60s before retrying a failed migration
const _failedCooldowns = new Map(); // migrationId → timestamp when retry is allowed
const FAILURE_COOLDOWN_MS = 60 * 1000;

// ── Logger ───────────────────────────────────────────────────────────────────

const log = {
  info:  (...args) => console.log(`[${new Date().toISOString()}] [INFO]`, ...args),
  warn:  (...args) => console.warn(`[${new Date().toISOString()}] [WARN]`, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] [ERROR]`, ...args),
};

// ── Wallet initialization ────────────────────────────────────────────────────

let client;
let wallet;
let keyPair;
let walletAddress;

async function initWallet() {
  if (!MNEMONIC) throw new Error('PHOENIX_AGENT_MNEMONIC not set');

  const words = MNEMONIC.trim().split(/\s+/);
  if (words.length !== 24) throw new Error(`Mnemonic must be 24 words, got ${words.length}`);

  keyPair = await mnemonicToPrivateKey(words);

  // Pass API key both as query param (some CDNs strip X-API-Key header) and as apiKey
  const rpcUrl = TONCENTER_KEY
    ? `${TON_RPC_URL}?api_key=${TONCENTER_KEY}`
    : TON_RPC_URL;

  client = new TonClient({ endpoint: rpcUrl, apiKey: TONCENTER_KEY || undefined });

  const walletContract = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  wallet = client.open(walletContract);
  walletAddress = walletContract.address;

  log.info(`Agent wallet: ${walletAddress.toString()}`);

  // Check balance (non-fatal — don't crash if TonCenter key is bad)
  try {
    const balance = await client.getBalance(walletAddress);
    log.info(`Wallet balance: ${Number(balance) / 1e9} TON`);
  } catch (e) {
    log.warn(`Could not fetch wallet balance: ${e.message}`);
    if (e.message.includes('401')) {
      log.error('TONCENTER_API_KEY appears invalid — check the key in Railway variables');
    }
  }
}

// ── Jetton wallet address lookup ─────────────────────────────────────────────

async function getJettonWalletAddress(jettonMaster, owner) {
  const masterAddr = typeof jettonMaster === 'string' ? Address.parse(jettonMaster) : jettonMaster;
  const ownerAddr = typeof owner === 'string' ? Address.parse(owner) : owner;

  const result = await client.runMethod(masterAddr, 'get_wallet_address', [
    { type: 'slice', cell: beginCell().storeAddress(ownerAddr).endCell() },
  ]);

  return result.stack.readAddress();
}

async function getJettonBalance(jettonMaster) {
  /**
   * Get agent wallet's balance of a specific jetton (human-readable units).
   */
  const masterAddr = typeof jettonMaster === 'string' ? Address.parse(jettonMaster) : jettonMaster;
  const jettonWalletAddr = await getJettonWalletAddress(masterAddr, walletAddress);

  try {
    const result = await client.runMethod(jettonWalletAddr, 'get_wallet_data', []);
    const balance = result.stack.readBigNumber();
    return Number(balance) / 1e9;
  } catch (e) {
    log.warn(`Could not read jetton balance: ${e.message}`);
    return 0;
  }
}

// ── SDK interface implementation ─────────────────────────────────────────────
// These methods match what the Teleton plugin tools expect from sdk.ton.*

async function sendTON(toAddress, amountTon, payloadBase64) {
  /**
   * Send TON with an optional pre-built BOC payload (base64-encoded cell).
   * Used by Groypad deploy (sends opcode cell as body).
   */
  const seqno = await wallet.getSeqno();
  const { Cell } = await import('@ton/core');

  let bodyCell;
  if (payloadBase64) {
    bodyCell = Cell.fromBoc(Buffer.from(payloadBase64, 'base64'))[0];
  }

  await wallet.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [
      internal({
        to: typeof toAddress === 'string' ? Address.parse(toAddress) : toAddress,
        value: toNano(amountTon.toFixed(9)),
        body: bodyCell,
      }),
    ],
  });

  await waitForSeqnoChange(seqno);
  log.info(`Sent ${amountTon} TON to ${toAddress}`);

  // Fetch real TX hash from the latest wallet transaction
  const txHash = await getLatestTxHash();
  log.info(`TX hash: ${txHash}`);
  return { txRef: txHash };
}

async function transferJetton(jettonMaster, destAddress, amount) {
  /**
   * Transfer jettons (TEP-74) from agent wallet to destination.
   * amount is in human-readable units (will multiply by 10^9).
   */
  const masterAddr = typeof jettonMaster === 'string' ? Address.parse(jettonMaster) : jettonMaster;
  const destAddr = typeof destAddress === 'string' ? Address.parse(destAddress) : destAddress;

  // Get agent's jetton wallet for this token
  const agentJettonWallet = await getJettonWalletAddress(masterAddr, walletAddress);
  const nanoAmount = BigInt(Math.floor(amount * 1e9));

  const body = beginCell()
    .storeUint(0xf8a7ea5, 32)       // op: JettonTransfer
    .storeUint(0, 64)               // query_id
    .storeCoins(nanoAmount)          // amount
    .storeAddress(destAddr)          // destination
    .storeAddress(walletAddress)     // response_destination (excess gas back)
    .storeBit(false)                 // no custom_payload
    .storeCoins(toNano('0.05'))      // forward_amount
    .storeBit(false)                 // no forward_payload
    .endCell();

  const seqno = await wallet.getSeqno();

  await wallet.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [
      internal({
        to: agentJettonWallet,
        value: toNano('0.15'),       // gas for jetton transfer
        body,
      }),
    ],
  });

  await waitForSeqnoChange(seqno);
  log.info(`Transferred ${amount} tokens (${jettonMaster}) → ${destAddress}`);
  return { txHash: `jetton_${Date.now()}`, txRef: `jetton_${Date.now()}` };
}

async function sendJettonTransfer({ jettonMaster, to, amount, forwardPayload, forwardAmount, queryId }) {
  /**
   * Detailed jetton transfer with custom forward payload (used for DeDust LP deposits).
   */
  const masterAddr = typeof jettonMaster === 'string' ? Address.parse(jettonMaster) : jettonMaster;
  const destAddr = typeof to === 'string' ? Address.parse(to) : to;
  const agentJettonWallet = await getJettonWalletAddress(masterAddr, walletAddress);

  const nanoAmount = typeof amount === 'bigint' ? amount : BigInt(Math.floor(Number(amount) * 1e9));
  const fwdAmount = forwardAmount || toNano('0.25');

  const bodyBuilder = beginCell()
    .storeUint(0xf8a7ea5, 32)       // op: JettonTransfer
    .storeUint(queryId || 0, 64)    // query_id
    .storeCoins(nanoAmount)          // amount
    .storeAddress(destAddr)          // destination
    .storeAddress(walletAddress)     // response_destination
    .storeBit(false);                // no custom_payload

  bodyBuilder.storeCoins(fwdAmount); // forward_amount

  if (forwardPayload) {
    bodyBuilder.storeBit(true);      // has forward_payload
    bodyBuilder.storeRef(forwardPayload);
  } else {
    bodyBuilder.storeBit(false);
  }

  const body = bodyBuilder.endCell();
  const seqno = await wallet.getSeqno();

  await wallet.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [
      internal({
        to: agentJettonWallet,
        value: toNano('0.5'),        // extra gas for forwarded payloads
        body,
      }),
    ],
  });

  await waitForSeqnoChange(seqno);
  log.info(`Jetton transfer (detailed) ${jettonMaster} → ${to}`);
  return { txHash: `jetton_fwd_${Date.now()}` };
}

async function simulateStonfiSwap(offerAddress, askAddress, offerUnits) {
  /**
   * Use StonApiClient.simulateSwap() to get:
   *   - Exact expected output (askUnits, minAskUnits)
   *   - Router info (address, majorVersion, minorVersion, ptonMasterAddress, routerType)
   * This is the single source of truth — no guessing versions or pTON addresses.
   */
  try {
    const result = await stonApi.simulateSwap({
      offerAddress,
      askAddress,
      offerUnits,
      slippageTolerance: '0.50', // 50% — matches our swap slippage
    });
    log.info(`STON.fi simulate: ${result.askUnits} ask, router v${result.router.majorVersion}.${result.router.minorVersion} @ ${result.router.address}, pTON: ${result.router.ptonMasterAddress}`);
    return result;
  } catch (e) {
    log.warn(`STON.fi simulateSwap failed: ${e.message}`);
    return null;
  }
}

async function getSwapQuote(fromToken, toToken, amount) {
  /**
   * Get best swap quote across DeDust and STON.fi.
   * Uses StonApiClient.simulateSwap() for exact STON.fi quotes + router info.
   */
  const amountNano = BigInt(Math.floor(amount * 1e9));
  const quotes = [];

  // Try DeDust — on-chain pool check
  try {
    const factory = client.open(Factory.createFromAddress(MAINNET_FACTORY_ADDR));
    const fromAsset = Asset.jetton(Address.parse(fromToken));
    const toAsset = toToken === 'TON' ? Asset.native() : Asset.jetton(Address.parse(toToken));
    const pool = client.open(await factory.getPool(PoolType.VOLATILE, [fromAsset, toAsset]));

    const estimate = await pool.getEstimatedSwapOut({
      assetIn: fromAsset,
      amountIn: amountNano,
    });
    const outAmount = Number(estimate.amountOut) / 1e9;
    if (outAmount > 0) {
      quotes.push({ outAmount, dex: 'dedust' });
      log.info(`DeDust quote: ${outAmount.toFixed(4)} TON`);
    }
  } catch (e) {
    log.warn(`DeDust quote failed: ${e.message}`);
  }

  // Try STON.fi — simulateSwap gives exact output + correct router/pTON info
  const TON_ADDR = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
  const askAddr = toToken === 'TON' ? TON_ADDR : toToken;
  const sim = await simulateStonfiSwap(fromToken, askAddr, amountNano.toString());
  if (sim && sim.askUnits && BigInt(sim.askUnits) > 0n) {
    const outAmount = Number(BigInt(sim.askUnits)) / 1e9;
    quotes.push({
      outAmount,
      dex: 'stonfi',
      simulation: sim, // carries router info, pTON address, minAskUnits
    });
    log.info(`STON.fi quote: ${outAmount.toFixed(4)} TON (router v${sim.router.majorVersion}.${sim.router.minorVersion})`);
  }

  if (quotes.length === 0) {
    return { outAmount: 0, dex: null, error: 'No liquidity on any DEX' };
  }

  // Return best quote
  const best = quotes.sort((a, b) => b.outAmount - a.outAmount)[0];
  log.info(`Best quote: ${best.outAmount.toFixed(4)} TON via ${best.dex}`);
  return best;
}

async function swap(fromToken, toToken, amount, opts = {}) {
  /**
   * Execute a swap: sell fromToken for toToken.
   * Routes to DeDust or STON.fi based on best quote.
   */
  const slippage = opts.slippage || 0.50; // 50% slippage default

  const quote = await getSwapQuote(fromToken, toToken, amount);
  if (quote.outAmount <= 0) {
    throw new Error(`No liquidity for swap ${fromToken} → ${toToken}`);
  }

  const minOut = Math.max(quote.outAmount * (1 - slippage), 0.000000001); // floor at 1 nanoton
  log.info(`Executing swap: ${amount} tokens → ~${quote.outAmount} TON via ${quote.dex} (min: ${minOut.toFixed(9)})`);

  if (quote.dex === 'dedust') {
    return await swapViaDedust(fromToken, toToken, amount, minOut, quote);
  } else if (quote.dex === 'stonfi') {
    return await swapViaStonfi(fromToken, toToken, amount, minOut, quote);
  } else {
    throw new Error(`Unknown DEX: ${quote.dex}`);
  }
}

async function swapViaDedust(fromToken, toToken, amount, minOut, quote) {
  const factory = client.open(Factory.createFromAddress(MAINNET_FACTORY_ADDR));
  const fromAsset = Asset.jetton(Address.parse(fromToken));
  const toAsset = toToken === 'TON' ? Asset.native() : Asset.jetton(Address.parse(toToken));

  const pool = client.open(await factory.getPool(PoolType.VOLATILE, [fromAsset, toAsset]));
  const jettonVault = client.open(await factory.getJettonVault(Address.parse(fromToken)));

  const swapPayload = VaultJetton.createSwapPayload({
    poolAddress: pool.address,
    limit: BigInt(Math.floor(minOut * 1e9)),
  });

  const agentJettonWallet = await getJettonWalletAddress(Address.parse(fromToken), walletAddress);
  const nanoAmount = BigInt(Math.floor(amount * 1e9));

  const body = beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(nanoAmount)
    .storeAddress(jettonVault.address)
    .storeAddress(walletAddress)
    .storeBit(false)
    .storeCoins(toNano('0.25'))
    .storeBit(true)
    .storeRef(swapPayload)
    .endCell();

  const seqno = await wallet.getSeqno();
  await wallet.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [internal({ to: agentJettonWallet, value: toNano('0.35'), body })],
  });

  await waitForSeqnoChange(seqno);
  log.info(`DeDust swap executed: ${amount} tokens → ~${quote.outAmount} TON`);
  return { outAmount: quote.outAmount, dex: 'dedust', txHash: `swap_dedust_${Date.now()}` };
}

async function swapViaStonfi(fromToken, toToken, amount, minOut, quote) {
  const sim = quote.simulation;
  if (!sim) throw new Error('STON.fi simulation data missing from quote');

  const nanoAmount = BigInt(Math.floor(amount * 1e9));
  // Use minAskUnits from simulation (already accounts for slippage), or our own floor
  const minAskAmount = BigInt(Math.floor(minOut * 1e9));
  const userAddr = AddressCore.parse(walletAddress.toString());
  const offerJettonAddress = AddressCore.parse(fromToken);

  const offerJettonWalletAddress = await getJettonWalletAddress(
    Address.parse(fromToken),
    walletAddress,
  );

  // Use dexFactory with the exact router info from simulateSwap —
  // this creates Router and pTON instances with the CORRECT addresses and version
  const routerInfo = sim.router;
  log.info(`Using STON.fi router v${routerInfo.majorVersion}.${routerInfo.minorVersion} @ ${routerInfo.address}, pTON: ${routerInfo.ptonMasterAddress}`);

  const dex = dexFactory(routerInfo);
  const router = client.open(dex.Router.create(AddressCore.parse(routerInfo.address)));
  const proxyTon = dex.pTON.create(AddressCore.parse(routerInfo.ptonMasterAddress));

  // provider is injected by client.open() — do NOT pass client as first arg
  const txParams = await router.getSwapJettonToTonTxParams({
    userWalletAddress: userAddr,
    offerJettonAddress,
    offerJettonWalletAddress: AddressCore.parse(offerJettonWalletAddress.toString()),
    offerAmount: nanoAmount,
    proxyTon,
    minAskAmount,
  });

  const seqno = await wallet.getSeqno();
  await wallet.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [
      internal({
        to: txParams.to.toString(),
        value: txParams.value,
        body: txParams.body,
      }),
    ],
  });

  await waitForSeqnoChange(seqno);
  log.info(`STON.fi v${routerInfo.majorVersion}.${routerInfo.minorVersion} swap executed: ${amount} tokens → ~${quote.outAmount} TON`);
  return { outAmount: quote.outAmount, dex: 'stonfi', txHash: `swap_stonfi_${Date.now()}` };
}

async function getLatestTxHash() {
  /**
   * Fetch the most recent transaction hash for the agent wallet via TonAPI.
   * Called after seqno changes to get the real on-chain TX hash.
   */
  try {
    const addr = walletAddress.toString();
    const resp = await fetch(`https://tonapi.io/v2/blockchain/accounts/${addr}/transactions?limit=1`, {
      headers: TON_API_KEY ? { Authorization: `Bearer ${TON_API_KEY}` } : {},
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`TonAPI ${resp.status}`);
    const data = await resp.json();
    const tx = data.transactions?.[0];
    if (tx?.hash) return tx.hash;
  } catch (e) {
    log.warn(`Could not fetch latest TX hash: ${e.message}`);
  }
  return `ton_${Date.now()}`; // fallback
}

// ── Wait for transaction confirmation ────────────────────────────────────────

async function waitForSeqnoChange(prevSeqno, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const current = await wallet.getSeqno();
      if (current > prevSeqno) return;
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  log.warn(`Seqno did not change within ${timeoutMs / 1000}s — TX may still be processing`);
}

// ── Build SDK context ────────────────────────────────────────────────────────

function buildSdk() {
  return {
    log,
    ton: {
      sendTON,
      transferJetton,
      sendJettonTransfer,
      getJettonBalance,
      getTonBalance: async () => Number(await client.getBalance(walletAddress)) / 1e9,
      getSwapQuote,
      swap,
      sender: {
        // Implements @ton/core Sender interface for DeDust factory calls
        send: async (args) => {
          const seqno = await wallet.getSeqno();
          await wallet.sendTransfer({
            seqno,
            secretKey: keyPair.secretKey,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            messages: [
              internal({
                to: args.to,
                value: args.value,
                body: args.body,
                init: args.init,
                bounce: args.bounce,
              }),
            ],
          });
          await waitForSeqnoChange(seqno);
        },
        address: walletAddress,
      },
    },
    secrets: {
      get: (key) => {
        const map = {
          TON_API_KEY: TON_API_KEY,
          TONCENTER_API_KEY: TONCENTER_KEY,
        };
        return map[key] || '';
      },
    },
    telegram: {
      sendMessage: async (bot, message) => {
        // Telegram messaging not available in standalone mode
        // Creator fee claims will fall back to manual_needed
        log.warn(`[TELEGRAM STUB] Would send to @${bot}: ${message}`);
        throw new Error('Telegram not available in standalone runner — manual claim needed');
      },
    },
  };
}

// ── Poll loop ────────────────────────────────────────────────────────────────

async function pollForSellingMigrations() {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (AGENT_KEY) headers['X-Agent-Key'] = AGENT_KEY;

    const resp = await fetch(`${BACKEND_URL}/api/migrations/?status=selling`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      log.warn(`Backend returned ${resp.status} when polling for selling migrations`);
      return;
    }

    const data = await resp.json();
    const migrations = data.migrations || [];

    if (migrations.length === 0) return;

    log.info(`Found ${migrations.length} migration(s) in selling status`);

    for (const mig of migrations) {
      if (_executing.has(mig.id)) {
        log.info(`Migration ${mig.id} already being executed — skipping`);
        continue;
      }

      const cooldownUntil = _failedCooldowns.get(mig.id);
      if (cooldownUntil && Date.now() < cooldownUntil) {
        const secsLeft = Math.ceil((cooldownUntil - Date.now()) / 1000);
        log.info(`Migration ${mig.id} on cooldown — retry in ${secsLeft}s`);
        continue;
      }

      log.info(`=== Starting execution for migration ${mig.id} (${mig.old_token_symbol}) ===`);
      _executing.add(mig.id);

      // Execute in background — don't block the poll loop
      executeMigration(mig.id).then(() => {
        _failedCooldowns.delete(mig.id); // success — clear any cooldown
      }).catch((err) => {
        log.error(`Migration ${mig.id} pipeline failed: ${err.message}`);
        _failedCooldowns.set(mig.id, Date.now() + FAILURE_COOLDOWN_MS);
        log.info(`Migration ${mig.id} on 60s cooldown before retry`);
      }).finally(() => {
        _executing.delete(mig.id);
      });
    }
  } catch (err) {
    log.error(`Poll error: ${err.message}`);
  }
}

async function executeMigration(migrationId) {
  const sdk = buildSdk();
  const allTools = tools(sdk);
  const executeTool = allTools.find(t => t.name === 'phoenix_execute_migration');

  if (!executeTool) {
    throw new Error('phoenix_execute_migration tool not found');
  }

  const result = await executeTool.execute({
    migration_id: migrationId,
    phoenix_token_address: PHX_ADDRESS || undefined,
    backend_url: BACKEND_URL,
    agent_key: AGENT_KEY,
  });

  if (result.success) {
    log.info(`=== Migration ${migrationId} COMPLETED SUCCESSFULLY ===`);
    log.info(`New token: ${result.new_token_address}`);
    log.info(`TON extracted: ${result.ton_extracted}`);
    log.info(`Distributions sent: ${result.distributions_sent}`);
    log.info(`Steps: ${result.steps.map(s => `${s.step}:${s.status}`).join(', ')}`);
  } else {
    log.error(`=== Migration ${migrationId} FAILED ===`);
    log.error(`Error: ${result.error}`);
    if (result.steps) {
      log.error(`Steps completed: ${result.steps.map(s => `${s.step}:${s.status}`).join(', ')}`);
    }
    throw new Error(`Failed at ${result.error}`);
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log.info(`Phoenix Agent v${manifest.version} — Standalone Runner`);
  log.info(`Backend: ${BACKEND_URL}`);
  log.info(`Poll interval: ${POLL_INTERVAL / 1000}s`);

  // Validate required env vars
  if (!MNEMONIC) {
    log.error('PHOENIX_AGENT_MNEMONIC is required');
    process.exit(1);
  }
  if (!AGENT_KEY) {
    log.warn('PHOENIX_AGENT_API_KEY not set — agent endpoints will be unauthenticated');
  }
  if (!TONCENTER_KEY) {
    log.error('⚠ TONCENTER_API_KEY not set — TonCenter will rate-limit all RPC calls (429). Get a free key at toncenter.com');
  }

  // Initialize wallet
  await initWallet();

  // Initial poll
  await pollForSellingMigrations();

  // Start polling loop
  setInterval(pollForSellingMigrations, POLL_INTERVAL);

  log.info('Agent is running — polling for selling migrations every 30s');
}

main().catch((err) => {
  log.error(`Fatal: ${err.message}`);
  process.exit(1);
});
