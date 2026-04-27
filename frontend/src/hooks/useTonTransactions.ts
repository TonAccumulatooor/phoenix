/**
 * useTonTransactions
 * ==================
 * Builds and sends TON blockchain transactions via TonConnect:
 *   - sendJettonDeposit: transfer OLDMEME jettons to the Phoenix vault
 *   - sendTonTopup: send TON to the vault as a community top-up
 *
 * After the transaction is sent and confirmed we POST the tx hash to the
 * backend so it's recorded (vault_monitor will also catch it independently).
 *
 * Jetton transfer cell layout (TEP-74):
 *   op_code:         0xf8a7ea5  (32 bits)
 *   query_id:        0          (64 bits)
 *   amount:          coins       (var uint)
 *   destination:     address     (267 bits)
 *   response_dest:   address     (267 bits)
 *   custom_payload:  null bit    (1 bit)
 *   forward_amount:  0.05 TON    (var uint) — notification to destination
 *   forward_payload: null bit    (1 bit)
 */

import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { beginCell, Address, toNano } from '@ton/core';
import { api } from '../lib/api';

const VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS as string;

// Gas budget sent with each jetton transfer for the forward notification
const JETTON_TRANSFER_FWD_TON = '0.05';
// Total TON attached to the jetton transfer message (gas + forward)
const JETTON_TRANSFER_GAS_TON = '0.1';

export interface TxResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export function useTonTransactions() {
  const [tonConnectUI] = useTonConnectUI();
  const walletAddress = useTonAddress();

  /**
   * Send OLDMEME jettons to the Phoenix vault.
   *
   * @param jettonWalletAddress  The sender's jetton wallet address for this token
   *                             (NOT the jetton master — the per-wallet contract)
   * @param amount               Token amount in human units (will be converted to nanos)
   * @param decimals             Token decimals (default 9)
   * @param migrationId          Used to post to backend after confirmation
   */
  async function sendJettonDeposit(
    jettonWalletAddress: string,
    amount: number,
    decimals: number,
    migrationId: string,
  ): Promise<TxResult> {
    if (!walletAddress) return { success: false, error: 'Wallet not connected' };
    if (!VAULT_ADDRESS) return { success: false, error: 'Vault address not configured' };

    try {
      const nanoAmount = BigInt(Math.floor(amount * 10 ** decimals));

      // Build TEP-74 JettonTransfer body cell
      const body = beginCell()
        .storeUint(0xf8a7ea5, 32)           // op: JettonTransfer
        .storeUint(0, 64)                    // query_id
        .storeCoins(nanoAmount)              // amount to transfer
        .storeAddress(Address.parse(VAULT_ADDRESS))    // destination
        .storeAddress(Address.parse(walletAddress))    // response_destination (excess gas back)
        .storeBit(false)                     // no custom_payload
        .storeCoins(toNano(JETTON_TRANSFER_FWD_TON))   // forward_amount
        .storeBit(false)                     // no forward_payload
        .endCell();

      const tx = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: jettonWalletAddress,
            amount: toNano(JETTON_TRANSFER_GAS_TON).toString(),
            payload: body.toBoc().toString('base64'),
          },
        ],
      });

      const txHash = tx.boc;   // TonConnect returns the BOC; hash derived server-side

      // Optimistically post to backend — vault monitor will also catch it
      try {
        await api.submitDeposit({
          migration_id: migrationId,
          wallet_address: walletAddress,
          amount,
          tx_hash: txHash,
        });
      } catch (backendErr) {
        // Non-fatal: vault monitor will pick it up
        console.warn('Backend deposit record failed (will retry via monitor):', backendErr);
      }

      return { success: true, txHash };
    } catch (err: any) {
      const msg = err?.message || 'Transaction failed';
      // User rejected — don't surface as error
      if (msg.includes('User rejects') || msg.includes('Reject')) {
        return { success: false, error: 'Cancelled' };
      }
      return { success: false, error: msg };
    }
  }

  /**
   * Send TON to the vault as a community top-up contribution.
   *
   * @param tonAmount    Amount in TON (human units)
   * @param migrationId  Used to post to backend after confirmation
   */
  async function sendTonTopup(tonAmount: number, migrationId: string): Promise<TxResult> {
    if (!walletAddress) return { success: false, error: 'Wallet not connected' };
    if (!VAULT_ADDRESS) return { success: false, error: 'Vault address not configured' };

    try {
      // Simple comment cell: op=0 + "Phoenix Top-up"
      const body = beginCell()
        .storeUint(0, 32)
        .storeStringTail(`Phoenix Top-up:${migrationId}`)
        .endCell();

      const tx = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: VAULT_ADDRESS,
            amount: toNano(tonAmount.toFixed(9)).toString(),
            payload: body.toBoc().toString('base64'),
          },
        ],
      });

      const txHash = tx.boc;

      try {
        await api.submitTopup({
          migration_id: migrationId,
          wallet_address: walletAddress,
          ton_amount: tonAmount,
          tx_hash: txHash,
        });
      } catch (backendErr) {
        console.warn('Backend topup record failed:', backendErr);
      }

      return { success: true, txHash };
    } catch (err: any) {
      const msg = err?.message || 'Transaction failed';
      if (msg.includes('User rejects') || msg.includes('Reject')) {
        return { success: false, error: 'Cancelled' };
      }
      return { success: false, error: msg };
    }
  }

  return { sendJettonDeposit, sendTonTopup };
}
