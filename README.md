# OrderGuard XL — 链上风控电路 & 非托管市场工具链（X Layer）

> **Ignix × TapeOut Genesis Transistor Hackathon** 参赛作品
> 把交易市场的风控规则做成**真实部署在链上的布尔电路**（NAND 网表），任何合约 / AI Agent 在结算订单前都可以免费调用 `eval()` 验证——无需预言机、无需信任第三方、结果永久可复现。

**English** | [中文](#中文说明)

---

## What is this?

OrderGuard is an on-chain processor deployed on **X Layer** (OKB, chain 196). Each "taped-out circuit" is a boolean risk-control rule encoded as a NAND netlist:

- **Tape-out**: deploy your circuit (NAND/LATCH netlist) on-chain via `tapeout()`
- **Verify**: call `eval(circuitId, inputs)` — instant, free, deterministic truth-table evaluation
- **Trade**: list circuit NFTs on the non-custodial marketplace at [tapemkt.com/xlayer](https://tapemkt.com/xlayer) — buyer pays seller directly (99% creator / 1% fee), the platform never touches funds, and every sale re-checks on-chain ownership (no double-selling). Anyone can tape out and list their own circuits.

### On-chain contracts (X Layer mainnet)

| Contract | Address |
|---|---|
| CPU Factory | `0x1f09daefa827f02cbb40967cc91b259763760761` |
| **OrderGuard processor** | `0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355` |
| Transistor (ERC1155-ish, NAND units) | `0x8e71FC45ff47E5a7bA1ad2960793ebAdD2739D9e` |

Fees (measured): tape-out `0.0013 OKB` + `0.0001 OKB` per NAND transistor + `0.00066 OKB` protocol fee.

### Circuits taped out on OrderGuard (all truth-tables verified on-chain)

| # | Circuit | I/O | Gates | Rule |
|---|---|---|---|---|
| 1 | Risk Alert Gate (Genesis) | 2→1 | 3 NAND | `out = NOT(priceOK AND fundsOK)` |
| 3 | Governance Majority Gate | 3→1 | 12 NAND | `MAJ3` — passes only with ≥2 approvals |
| 4 | On-chain Half Adder | 2→2 | 5 NAND | `sum=XOR, carry=AND` — dual-output demo |
| 5 | Dual-Key Comparator | 4→1 | 14 NAND | opens only when `(a0,a1) == (b0,b1)` |

Live demo & marketplace: **https://tapemkt.com/xlayer**

## Quick start

```bash
npm install ethers

# deploy your own processor (factory createCPU, 0.0066 OKB deploy fee)
node xl-deploy-cpu.js

# tape out a circuit (buys transistors + tapeout + prints tx)
node xl-tapeout-rest.js

# list a circuit on the marketplace (non-custodial, 0.01 OKB)
node src/xl-list.js <tokenId> <priceOKB> [name]
```

Private keys are read from `KEY_FILE` env var (never commit keys — see `.gitignore`).

## Netlist binary format

See [NETLIST-FORMAT.md](NETLIST-FORMAT.md) — the full reverse-engineered spec of TapeOut's netlist encoding: signal numbering, NAND/LATCH/REF opcodes, big-endian u24/u64, output buffering, and eval bit-packing.

## 中文说明

OrderGuard 是部署在 **X Layer** 上的链上风控处理器。每张「流片电路」是一条用 NAND 网表编码的布尔风控规则：

- **流片**：`tapeout()` 把网表部署上链
- **验证**：`eval(circuitId, inputs)` 即时、免费、确定性地输出真值表结果
- **交易**：在 [tapemkt.com/xlayer](https://tapemkt.com/xlayer) 非托管挂单出售——买家钱包直付卖家（99% 创作者 / 1% 平台费），成交前链上复核卖家持有（防一电多卖）

**2026-10-05**: marketplace is live on X Layer mainnet — tape-out, eval verification and non-custodial OKB settlement all functional end-to-end.

网表二进制格式见 [NETLIST-FORMAT.md](NETLIST-FORMAT.md)（逆向自官方实现并实测验证）。

## Hackathon

Entered in the **TapeOut Genesis Transistor Hackathon** (Sep 22 – Oct 6, 2026 HKT) hosted by [@Ignixbot](https://x.com/Ignixbot) on [@XLayerOfficial](https://x.com/XLayerOfficial). Ranking is based on *what you built* — this repo contains the full toolchain behind the live market.

## License

MIT
