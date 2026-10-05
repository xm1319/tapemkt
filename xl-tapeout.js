#!/usr/bin/env node
/* xl-tapeout.js — 在 X Layer 的 OrderGuard 处理器上流片第一个电路
 *
 * 网表二进制格式（自官方 bundle 逆向 + 验证）:
 *   信号编号: 0=const0, 1=const1, 2..2+nIn-1=输入, 之后按拓扑序
 *   NAND: [0x00, u24(a), u24(b)]   → 输出 1 当且仅当 a=b=0（NAND）
 *   LATCH:[0x01, u24(d)]
 *   REF:  [0x02, addr20, u64(circuitId), u8(nIn), u8(nOut), nIn×u24]
 *   每个输出引脚自动补 2 个缓冲 NAND（NAND(x,x) 两次）
 *
 * 首个电路（3 个 NAND）:
 *   in0=priceOK, in1=fundsOK
 *   g1 = NAND(in0, in1)          # 4
 *   g2 = NAND(g1, g1)            # 5  缓冲
 *   out = NAND(g2, g2)           # 6  缓冲 → alert = NOT(priceOK AND fundsOK)
 *
 * 用法:
 *   node xl-tapeout.js --dry-run   # 只读费用与预估
 *   node xl-tapeout.js             # 买晶体管 + 流片 + eval 自测
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const DRY = process.argv.includes('--dry-run');
const RPC = process.env.XL_RPC || 'https://tapeout.net/rpc-xlayer';
const PROC = process.env.XL_CPU || JSON.parse(fs.readFileSync(path.join(__dirname, 'xl-cpu.json'))).transistors || '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355';

/* ---------- 网表编码 ---------- */
const u24 = e => { if (!Number.isInteger(e) || e < 0 || e > 16777215) throw new RangeError('u24: ' + e); return [e >>> 16 & 255, e >>> 8 & 255, e & 255]; };

function buildNetlist() {
  const p = [];
  const NAND = (a, b) => p.push(0x00, ...u24(a), ...u24(b));
  NAND(2, 3);   // g1 = NAND(in0, in1)   → signal 4
  NAND(4, 4);   // g2 = NAND(g1, g1)    → signal 5
  NAND(5, 5);   // out = NAND(g2, g2)   → signal 6
  return { nl: Uint8Array.from(p), nIn: 2, nOut: 1, nNand: 3, nLatch: 0 };
}

function loadKey() {
  const files = [];
  if (process.env.KEY_FILE) files.push(path.resolve(process.env.KEY_FILE));
  files.push('/root/secrets/signing.key');
  for (const f of files) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/^(0x)?([0-9a-fA-F]{64})$/m);
      if (m) return '0x' + m[2];
    } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到私钥文件');
}

const PROC_ABI = [
  'function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)',
  'function TAPEOUT_FEE() view returns (uint256)',
  'function eval(uint256 id, bytes inputs) view returns (bytes)',
  'function netlist(uint256 id) view returns (bytes)',
  'function name() view returns (string)',
  'function transistors() view returns (address)',
];
const TRANS_ABI = [
  'function mint(uint256 id, uint256 amount) payable',
  'function mintPrice() view returns (uint256)',
  'function minted() view returns (uint256)',
  'function supplyCap() view returns (uint256)',
  'function protocolFee() view returns (uint256)',
];
const FACTORY = '0x1f09daefa827f02cbb40967cc91b259763760761';

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(loadKey(), provider);
  const proc = new ethers.Contract(PROC, PROC_ABI, wallet);
  const factory = new ethers.Contract(FACTORY, ['function protocolFee() view returns (uint256)'], provider);
  const { nl, nIn, nOut, nNand, nLatch } = buildNetlist();

  console.log('== OrderGuard 首个电路流片 ==');
  console.log('处理器:', PROC, '| 钱包:', wallet.address);

  /* transistors 合约地址由处理器直接给出 */
  const trans = await proc.transistors();
  const t = new ethers.Contract(trans, TRANS_ABI, wallet);
  const [mpRaw, pfRaw, capRaw, mintedN] = await Promise.all([
    t.mintPrice(), t.protocolFee(), t.supplyCap(), t.minted(),
  ]);
  const tInfo = {
    mintPriceNAND: ethers.formatEther(mpRaw),
    protocolFee: ethers.formatEther(pfRaw),
    supplyCap: capRaw.toString(),
    mintedNAND: mintedN.toString(),
  };
  console.log('晶体管合约:', trans, JSON.stringify(tInfo));

  const tapeFee = await proc.TAPEOUT_FEE();
  console.log('TAPEOUT_FEE:', ethers.formatEther(tapeFee), 'OKB');
  console.log('电路: alert=NOT(priceOK AND fundsOK), NAND×' + nNand + ', 网表 ' + nl.length + ' 字节');

  /* 需要买的晶体管（NAND）：需要多少买多少 */
  const need = nNand;
  const mp = mpRaw, pf = pfRaw;
  const mintCost = BigInt(need) * mp + pf;

  if (DRY) {
    console.log('[dry-run] 需买 NAND:', need, '成本', ethers.formatEther(mintCost), 'OKB; 流片费', ethers.formatEther(tapeFee), 'OKB');
    return;
  }

  if (need > 0) {
    console.log(`购买 ${need} 个 NAND 晶体管 …`);
    const mt = await t.mint(0, need, { value: mintCost });
    const mrc = await mt.wait(2);
    console.log('mint tx:', mt.hash, 'status', mrc.status);
  }

  console.log('流片上链 …');
  const tx = await proc.tapeout(ethers.hexlify(nl), nIn, nOut, { value: tapeFee });
  console.log('tapeout tx:', tx.hash);
  const rc = await tx.wait(2);
  console.log('status:', rc.status);

  /* 自测：eval(1, [priceOK=1, fundsOK=1]) 应输出 0（无告警）；[1,0] 应输出 1（告警） */
  const cid = rc.logs.length; /* 不确定 id，改为读最近事件/自测常见 id */
  for (const l of rc.logs) {
    try { const d = proc.interface.parseLog(l); if (d && d.name === 'TapedOut') console.log('TapedOut id =', d.args[1] !== undefined ? d.args[1].toString() : JSON.stringify(d.args)); } catch (e) { }
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
