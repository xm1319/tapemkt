#!/usr/bin/env node
/* xl-tapeout-rest.js — 流片剩余两颗电路（半加器、双钥比对器）+ 全组合验证 + 挂单
 * MAJ3 已流片 = id 3。id 用「网表匹配」定位（TapedOut 事件不含 id）。
 */
'use strict';
const fs = require('fs');
const { ethers } = require('ethers');
const RPC = process.env.XL_RPC || 'https://tapeout.net/rpc-xlayer';
const DOLIST = process.argv.includes('--list');
const PROC = '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355';
const API = 'http://127.0.0.1:8787';
const u24 = e => [e >>> 16 & 255, e >>> 8 & 255, e & 255];

function halfAdder() {
  /* 2 输入: 门 i 的输出信号 = 4+i。门0→4, 门1→5, 门2→6, 门3→7(sum), 门4→8(carry) */
  const p = []; const N = (a, b) => p.push(0x00, ...u24(a), ...u24(b));
  const a = 2, b = 3, n1 = 4;
  N(a, b); const n2 = 5, n3 = 6; N(a, n1); N(b, n1);
  const sum = 7, carry = 8; N(n2, n3); N(n1, n1);
  return { nl: Uint8Array.from(p), nIn: 2, nOut: 2, nNand: 5, name: '链上半加器 Half Adder', exp: v => [((v & 1) ^ (v >> 1 & 1)), ((v & 1) & (v >> 1 & 1))] };
}
function eq2() {
  const p = []; const N = (a, b) => p.push(0x00, ...u24(a), ...u24(b));
  const a0 = 2, a1 = 3, b0 = 4, b1 = 5;
  const x1 = 6; N(a0, b0); const x2 = 7, x3 = 8; N(a0, x1); N(b0, x1);
  const x4 = 9, x5 = 10; N(x2, x3); N(x4, x4);
  const y1 = 11; N(a1, b1); const y2 = 12, y3 = 13; N(a1, y1); N(b1, y1);
  const y4 = 14, y5 = 15; N(y2, y3); N(y4, y4);
  const y6 = 16, out = 17; N(x5, y5); N(y6, y6);
  return { nl: Uint8Array.from(p), nIn: 4, nOut: 1, nNand: 14, name: '双钥比对器 EQ2', exp: v => [((v & 1) === (v >> 2 & 1)) && ((v >> 1 & 1) === (v >> 3 & 1)) ? 1 : 0] };
}
const CIRCUITS = [halfAdder(), eq2()];

function loadKey() {
  const m = fs.readFileSync('/root/secrets/signing.key', 'utf8').match(/^(0x)?([0-9a-fA-F]{64})$/m);
  if (!m) throw new Error('找不到私钥');
  return '0x' + m[2];
}

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(loadKey(), provider);
  const proc = new ethers.Contract(PROC, [
    'function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)',
    'function TAPEOUT_FEE() view returns (uint256)',
    'function eval(uint256 id, bytes inputs) view returns (bytes)',
    'function netlist(uint256 id) view returns (bytes)',
    'function transistors() view returns (address)',
  ], wallet);
  const trans = await proc.transistors();
  const t = new ethers.Contract(trans, ['function mint(uint256,uint256) payable', 'function mintPrice() view returns (uint256)', 'function protocolFee() view returns (uint256)'], wallet);
  const [mp, pf, tapeFee, bal] = await Promise.all([t.mintPrice(), t.protocolFee(), proc.TAPEOUT_FEE(), provider.getBalance(wallet.address)]);
  console.log('钱包:', wallet.address, '| 余额:', ethers.formatEther(bal), 'OKB');

  const mine = ethers.hexlify; // 比较 helper
  for (const c of CIRCUITS) {
    console.log('\n==== ' + c.name + ' (' + c.nNand + ' NAND, ' + c.nIn + '入' + c.nOut + '出) ====');
    const mt = await t.mint(0, c.nNand, { value: BigInt(c.nNand) * mp + pf });
    const mrc = await mt.wait(2);
    console.log('晶体管 mint:', mt.hash.slice(0, 20) + '…', 'status', mrc.status);

    const tx = await proc.tapeout(mine(c.nl), c.nIn, c.nOut, { value: tapeFee });
    const rc = await tx.wait(2);
    console.log('tapeout tx:', tx.hash, 'status', rc.status);

    /* 网表匹配定位 id（扫 1..12） */
    let cid = null;
    for (let id = 1; id <= 12; id++) {
      try { if ((await proc.netlist(id)) === mine(c.nl)) { cid = id; break; } } catch (e) { }
    }
    if (cid === null) { console.error('❌ 未能定位电路 id，中止'); process.exit(1); }
    console.log('电路 id =', cid);

    const combos = 1 << c.nIn;
    let pass = 0; const rows = [];
    for (let v = 0; v < combos; v++) {
      const ov = Number(ethers.toBigInt(await proc.eval(cid, '0x' + v.toString(16).padStart(2, '0'))));
      const exp = c.exp(v);
      const got = []; for (let k = 0; k < c.nOut; k++) got.push((ov >> k) & 1);
      const ok = got.every((g, k) => g === exp[k]);
      if (ok) pass++;
      rows.push((v.toString(2).padStart(c.nIn, '0')) + ' → ' + got.join(',') + (ok ? ' ✓' : ' ✗ 应' + exp.join(',')));
    }
    console.log('全组合验证: ' + pass + '/' + combos);
    console.log(rows.join('\n'));
    if (pass !== combos) { console.error('❌ 有失败组合'); process.exit(1); }
    c.id = cid;
  }

  if (DOLIST) {
    for (const c of CIRCUITS) {
      const ts = Date.now();
      const msg = 'TapeOut市场·挂单确认\n卖家: ' + wallet.address + '\n品种: ' + PROC + ' #' + c.id + '\n数量: 1\n单价: 0.01 OKB\n时间: ' + ts;
      const sig = await wallet.signMessage(msg);
      const r = await fetch(API + '/api/mk/list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: 'xl', name: c.name, circuits: PROC, tokenId: c.id, qty: 1, priceBnb: '0.01', seller: wallet.address, ts, sig }),
      });
      const j = await r.json();
      console.log('挂单 ' + c.name + ':', r.status, j.ok ? ('✅ 单号 ' + j.id) : JSON.stringify(j).slice(0, 120));
    }
  }
  console.log('\n✅ 完成');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
