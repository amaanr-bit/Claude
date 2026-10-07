# Aave UI withdraw "Failed to fetch": Bullish / Fireblocks

Wallet: `0x56957E411Ea83a0B4A0689C1fB0D1e5eA0d20149` (EOA, Fireblocks MPC), V3 Core (Ethereum), aUSDC.
Tested against live app.aave.com at aave/interface `a0e046e` on 2026-10-07.

## TL;DR

- **The bug doesn't reproduce now.** Withdraw of 10 USDC and of Max (uint256.max) both build correctly, pass gas
  estimation, and reach the wallet as `eth_sendTransaction` to Pool `0x8787…4E2`.
  This holds for both an injected EIP-1193 wallet and a real WalletConnect session.
- **The contracts are fine,** which matches the DeFi Saver result. The position is healthy (133.79M aUSDC, no debt), and Pool `eth_estimateGas` succeeds for Max.
- **No recent change to the withdraw code path.** `WithdrawActions` → `useTransactionHandler` → `poolSlice.withdraw`
  (contract-helpers) is unchanged by recent merges. The last deploy (#3119) was CSS only.
- **Most likely cause:** "Failed to fetch" is a browser `TypeError` from `fetch()` (network or CORS failure).
  It isn't an RPC revert. In the UI's send path, the only cross-origin browser fetch that happens before the wallet sees the
  tx is the **wagmi transport RPC `https://mainnet.gateway.tenderly.co`**:
  - **WalletConnect connector:** ethers `signer.sendTransaction` first calls `eth_blockNumber`. The WC provider routes that
    to `rpcMap[1]`, which is the Tenderly gateway. Observed in the WC run:
    `POST https://mainnet.gateway.tenderly.co {"method":"eth_blockNumber"}` is sent right before `eth_sendTransaction`.
  - **"Institutional Wallets" (Narval Connect, which fronts Fireblocks/BitGo/Anchorage):** `@narval-xyz/connect` sends
    `eth_blockNumber`, `eth_estimateGas`, `eth_call`, `eth_getTransactionReceipt`, and similar calls directly from the browser to
    `readonlyRpcMap[chainId]`, also the Tenderly gateway (`narval-connector.js` → `widget.makeReadonlyRpcCall`).

  If that host can't be reached from the user's browser (a corporate proxy or endpoint filter blocking `*.tenderly.co`,
  a transient gateway or CORS failure, an extension), the send aborts with `Failed to fetch` before Fireblocks is
  contacted. That matches "tx never reached Fireblocks for signing". Someone on "their own connection" with the same managed
  laptop or browser policy would hit it too. DeFi Saver uses its own RPC, so it would be unaffected.
- **One thing doesn't fit:** a UI deposit goes through the same `sendTx` → `eth_blockNumber` path, so if deposits through the
  Aave UI really worked in the same session, a blocked Tenderly host doesn't explain it alone.
  The other candidate is the Narval widget's own backend (`api.narval.xyz` / `widget.narval.xyz`) failing on the
  `eth_sendTransaction` hop. Its error message is rethrown verbatim as `new Error(message)`.

## On-chain timeline (Aave API)

Since Dec 2025 the wallet has withdrawn ~23:33 UTC and re-supplied ~00:10 UTC daily, all direct to the Pool.
2026-10-06 23:57:35: full withdraw of 133,783,328.27 USDC (gas limit 212018, unlike the usual 245492/252270/300000),
which is likely the DeFi Saver recovery. Re-supplied at 2026-10-07 00:28. **So the incident window is about 2026-10-06 23:30–23:57 UTC.**
No Tenderly status-page incident is listed for that window.

## What to ask Bullish

1. Which connect option did they use: **WalletConnect** (Fireblocks console) or **Institutional Wallets** (Narval)?
   Did the deposit go through the Aave UI in the same session?
2. Exact time (UTC) plus a browser console screenshot or HAR. Look for the failed request's host:
   `mainnet.gateway.tenderly.co` vs `*.narval.xyz` vs `app.aave.com/api/rpc-proxy`.
3. From their machine, run in devtools on app.aave.com:
   `fetch('https://mainnet.gateway.tenderly.co',{method:'POST',headers:{'content-type':'application/json'},body:'{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'}).then(r=>r.json()).then(console.log)`

## Suggested hardening (aave/interface)

- Point the wagmi `transports` (and therefore the WalletConnect `rpcMap` and Narval `readonlyRpcMap`) at the same-origin
  `/api/rpc-proxy` (or `fallback([...])` over several RPCs) instead of `publicJsonRPCUrl[0]` only
  (`src/ui-config/wagmiConfig.ts` `getTransport`). Then wallet submission doesn't depend on one public third-party RPC
  being reachable from the client.
- Surface the failing host in the tx error UI or Sentry. Right now a raw `TypeError: Failed to fetch` gives support nothing to go on.

## Repro harness

```
npm i playwright && CHROME_PATH=/path/to/chromium node injected-impersonation.js 10    # or: max
CHROME_PATH=... node walletconnect-impersonator.js 10 withdraw                         # or: 0.001 supply
```

- `injected-impersonation.js` injects an EIP-1193/6963 provider that impersonates the address, forwards reads to a public
  RPC, and rejects `eth_sendTransaction`. It logs everything the UI sends to the wallet.
- `walletconnect-impersonator.js` pairs app.aave.com with impersonator.xyz over real WalletConnect.
  Caveat: impersonator.xyz approves sessions with `methods: []`, so the dApp's sign-client refuses every
  `eth_sendTransaction` with `isValidRequest() failed`. That affects supply too, so it's a test-tool artifact, not this bug. The script patches
  the stored session's methods in IndexedDB and reloads, after which the withdraw request does reach the wallet over the relay.
