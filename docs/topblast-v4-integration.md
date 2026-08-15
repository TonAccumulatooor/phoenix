# Topblast / Uranus v4 integration reference

Source: `@dedust/kit@0.0.4`, `dist/uranus/*.gen.d.ts` — generated bindings for the
deployed contracts, not documentation. This is authoritative.

Topblast runs on DeDust's Uranus contracts. MemeFactory v4 (Topblast's naming) is
the same address DeDust documents as v3.1:

    EQAmkd4Pd_xgUW4b9MLrygf0SOfR2EUVa_iCtVWGnYB2hItG

## Deploy message

```
struct (0x6ff416dc) DeployMemeMessage {
    queryId: uint64
    presetId: uint4
    metadata: MemeMetadata          // { uri: string } — stored as a string ref tail
    initialBuy: coins
    partnerConfig: PartnerConfig?   // { partnerId: uint256, partnerFeeBps: uint16 }
    referrerConfig: ReferrerConfig? // { referrerId: uint256, referrerFeeBps: uint16 }
}
```

Serialization, from `MemeFactory.gen.js`:

```js
b.storeUint(0x6ff416dc, 32);
b.storeUint(self.queryId, 64);
b.storeUint(self.presetId, 4);
b.storeStringRefTail(self.metadata.uri);   // ref BEFORE initialBuy
b.storeCoins(self.initialBuy);
storeTolkNullable(self.partnerConfig, b, PartnerConfig.store);   // 1 bit, 0 = null
storeTolkNullable(self.referrerConfig, b, ReferrerConfig.store); // 1 bit, 0 = null
```

Deploy and dev buy are a single message: `initialBuy` is the dev buy.

### What the old agent had wrong

`phoenix-agent/index.js` built the cell by hand as:

    op(32) | qid(64) | flag:uint4(=4) | forward_amount:Coins | pad:uint2(=0) | ref[url]

Three defects, any one of which breaks the parse:

1. The metadata ref must come **before** `initialBuy`, not after.
2. The trailing two bits are two independent nullable flags, not a pad, and they
   belong at the **end** rather than mid-message.
3. `presetId` was hardcoded to 4. It selects a bonding-curve preset (see below).

The opcode itself was correct and is unchanged in v4, so the 30.75 GRAM loss is
better explained by the wrong factory address than by a malformed body.

## Errors the factory can throw

```
ErrorCode.BondingCurveParametersMalformed
ErrorCode.SlippageExceeded
ErrorCode.PresetNotExist          // presetId out of range
ErrorCode.MessageValueTooLow
ErrorCode.InitialBuyLimitExceeded // there is a cap on the dev buy
ErrorCode.UnknownOperation
```

`InitialBuyLimitExceeded` matters for Phoenix: a single dev buy may not be able to
fund a full graduation. Needs testing against a real preset.

## Creator address — the LP owner question

`DeployMemeMessage` has **no creator/owner field**. The Meme contract stores:

```
struct MemeConfig {
    creatorAddress: address
    controllerAddress: address
    ...
}
```

and `creatorAddress` is populated by the factory, from the deploy sender. Fees are
claimed with:

```
struct (0xad7269a8) ClaimCreatorFeeMessage {
    queryId: uint64
    to: address?          // fees are PAID OUT to an arbitrary address
    excessesTo: address?
}
```

There is no message in the ABI that reassigns `creatorAddress`.

**Consequence for Phoenix:** deploying makes the *agent wallet* the permanent
creator. The community wallet cannot be set as creator at deploy time. What the
agent CAN do is claim to an arbitrary address — `ClaimCreatorFeeMessage.to` — so
fees can be routed to the community wallet on every claim.

That is custodial in a way the 51% mechanic is not: the agent must keep choosing
to forward. The topblast.lol "direct creator rewards to any TON wallet" toggle is
therefore an application-layer feature of their platform, not a property of the
contract. Confirm with @sickz whether they expose a way to make it trustless.

## Topblast does not send DeployMemeMessage — CRITICAL

Verified on-chain against two real launches (2026-08-15):

| token | tradeFeeBps | factory inbound opcode |
|---|---|---|
| `EQAm3zO8VWQs1--V3rCjiK1DDFdt0WiY7tks7vLI7SOIoFlg` | 100 (1%) | `0x632f5d1c` |
| `EQAmbxmcovH5pirI1ZgfCYcDzeWPxZen2eLedUmMq7Dv4luc` | 300 (3%) | `0x632f5d1c` |

Both deploys reached the factory as **`0x632f5d1c`**, not `0x6ff416dc`. The factory
then emits the documented `InitMemeMessage` (`0x796f5a0c`) to the new token, so
everything downstream matches the SDK — only the entry message differs.

`0x632f5d1c` appears nowhere in `@dedust/kit@0.0.4` (published 2026-05-19, the
newest version). The sender is a plain `wallet_v5r1`, not a contract, so this is a
message an ordinary user wallet sends directly to the factory — the same thing
Phoenix needs to send.

Attempting to parse the body as `DeployMemeMessage` is misleading: it parses, and
the `uri` field even decodes to a clean `ipfs://` URL, but both tokens then report
`presetId: 1` despite having different fee tiers, and 640+ bits are left over. The
layout is genuinely different; do not trust a forced decode.

**Consequence:** the deploy rewrite currently emits `0x6ff416dc`, which is the
schema the SDK documents but not the one Topblast's own launches use. Whether the
factory still accepts `0x6ff416dc` is untested. Resolve before any live deploy.

Ask @sickz or the DeDust dev chat for the `0x632f5d1c` schema, or for the SDK
version that includes it.

## Fee tiers and presetId

`MemeStorage.baseFeeBps` and `GetMemeDataReply.tradeFeeBps` are `uint16` basis
points. Confirmed on-chain via `get_meme_data` (note: snake_case, not
`getMemeData`) on the two tokens above — 100 and 300, i.e. 1% and 3%.

The same call also confirms `onSellSupply = 700_000_000` on both, independently
verifying the 70% curve-supply figure now in `config.py`.

The presetId → fee mapping remains unknown, and cannot be recovered until the
`0x632f5d1c` layout is known, since that is where a real deploy carries it.

Useful fields from `get_meme_data`, in stack order:

    initialized, migrated, controllerAddress, creatorAddress, creatorFee,
    seed, isGraduated, alpha, beta, onSellSupply, tradeFeeBps,
    raisedFunds, currentSupply

`raisedFunds` and `isGraduated` let the agent track graduation from the contract
rather than estimating it.

## Other messages of interest

```
(0x94826557) BuyMessage   { queryId, amount, minimalAmountOut, excessesTo, partner?, referrer? }
(0x646ad424) SellMessage  { queryId, amount, minimalAmountOut, from, excessesTo?, partner?, referrer? }
(0xad7269a8) ClaimCreatorFeeMessage { queryId, to?, excessesTo? }
```

`BuyMessage.minimalAmountOut` gives real slippage protection — the current agent
uses a 50% slippage tolerance on STON.fi sells, which is a separate path, but any
Topblast-side buys should set this properly.

`GetMemeDataReply` exposes `raisedFunds`, `currentSupply`, `isGraduated`, `alpha`,
`beta` — enough to track graduation progress directly from the contract instead of
estimating it.

## Still unknown

- presetId → fee tier mapping
- the `InitialBuyLimitExceeded` cap
- whether `partnerConfig` / `referrerConfig` matter to Phoenix (revenue share?)
- exact gas required beyond `initialBuy`
