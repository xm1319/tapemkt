#!/usr/bin/env node
/* xl-deploy-cpu.js — X Layer 上通过 TapeOut 工厂部署处理器（黑客松参赛用）
 *
 * 用法（在 VPS 上）:
 *   node xl-deploy-cpu.js --dry-run                       # 只估费用不出tx
 *   node xl-deploy-cpu.js                                 # 用默认参数真实部署
 *   node xl-deploy-cpu.js --name X --symbol Y --story Z --supply 10000 --price 0.0001
 *
 * 费用结构（2026-10-04 实测）: deployFee=0.0066 OKB, gas≈0.021gwei 忽略
 * 工厂: 0x1f09daefa827f02cbb40967cc91b259763760761 (chainId 196)
 * 私钥读取顺序与 server.js 一致: KEY_FILE env > /root/secrets/signing.key
 * 结果落盘 xl-cpu.json（transistors/circuits 地址），供后续网关与前端接入
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

/* ---------- 参数 ---------- */
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');

const RPC = process.env.XL_RPC || 'https://tapeout.net/rpc-xlayer';
const FACTORY = '0x1f09daefa827f02cbb40967cc91b259763760761';

/* 默认参数：OrderGuard——电路交易市场链上风控校验处理器（黑客松用例） */
const NAME = argOf('--name', 'OrderGuard');
const SYMBOL = argOf('--symbol', 'OGD');
const STORY = argOf('--story',
  'OrderGuard is the on-chain risk-control processor for circuit marketplaces. ' +
  'Each taped-out circuit encodes a boolean risk rule (price-deviation flags, duplicate-payment bits, ' +
  'allowlist gates) that AI trading agents can evaluate on X Layer before settling an order. ' +
  'Deployed with tapemkt.com - a live circuit marketplace - as its first integration.');
const SUPPLY = BigInt(argOf('--supply', '10000'));     // XL quality 门槛: minSupplyCap=10000
const PRICE = argOf('--price', '0.0001');              // mintPrice, OKB

/* ---------- 私钥（与 server.js 同口径） ---------- */
function loadKey() {
  const files = [];
  if (process.env.KEY_FILE) files.push(path.resolve(process.env.KEY_FILE));
  files.push('/root/secrets/signing.key');
  for (const f of files) {
    try {
      const txt = fs.readFileSync(f, 'utf8');
      const m = txt.match(/^(0x)?([0-9a-fA-F]{64})$/m);
      if (m) return '0x' + m[2];
    } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到可用私钥文件（KEY_FILE / /root/secrets/signing.key）');
}

/* ---------- ABI ---------- */
const FACTORY_ABI = [
  'function createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) payable returns (address transistors, address circuits)',
  'function deployFee() view returns (uint256)',
  'function protocolFee() view returns (uint256)',
  'function cpuCount() view returns (uint256)',
  'event CPUCreated(address indexed transistors, address indexed circuits, string name, string symbol)',
];

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  if (net.chainId !== 196n) throw new Error('chainId 不是 196: ' + net.chainId);
  const wallet = new ethers.Wallet(loadKey(), provider);
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);

  const [deployFee, cpuCount] = await Promise.all([factory.deployFee(), factory.cpuCount()]);
  const feeData = await provider.getFeeData();
  const bal = await provider.getBalance(wallet.address);

  console.log('== X Layer 处理器部署 ==');
  console.log('钱包      :', wallet.address);
  console.log('OKB 余额  :', ethers.formatEther(bal));
  console.log('deployFee :', ethers.formatEther(deployFee), 'OKB');
  console.log('现有处理器:', cpuCount.toString());
  console.log('参数      :', { NAME, SYMBOL, SUPPLY: SUPPLY.toString(), PRICE, STORY: STORY.slice(0, 60) + '…' });

  const priceWei = ethers.parseEther(PRICE);
  const data = factory.interface.encodeFunctionData('createCPU', [NAME, SYMBOL, STORY, SUPPLY, priceWei]);
  const gasEst = await provider.estimateGas({ to: FACTORY, data, value: deployFee, from: wallet.address });
  const gasCost = gasEst * (feeData.gasPrice || 0n);
  const total = deployFee + gasCost;
  console.log('预计 gas  :', ethers.formatEther(gasCost), 'OKB  (gasLimit', gasEst.toString() + ')');
  console.log('合计      :', ethers.formatEther(total), 'OKB');
  if (bal < total) throw new Error('余额不足！需要 ' + ethers.formatEther(total) + ' OKB，请先充值到该地址（X Layer 网络）');

  if (DRY) { console.log('[dry-run] 未发送交易'); return; }

  console.log('发送 createCPU …');
  const tx = await wallet.sendTransaction({ to: FACTORY, data, value: deployFee, gasLimit: gasEst * 120n / 100n });
  console.log('tx:', tx.hash);
  const rc = await tx.wait(2);
  let transistors = null, circuits = null;
  for (const log of rc.logs) {
    if (log.address.toLowerCase() !== FACTORY.toLowerCase()) continue;
    try {
      const ev = factory.interface.parseLog(log);
      if (ev && ev.name === 'CPUCreated') { transistors = ev.args.transistors; circuits = ev.args.circuits; }
    } catch (e) { /* 非本事件 */ }
  }
  console.log('== 部署完成 ==');
  console.log('transistors:', transistors);
  console.log('circuits   :', circuits);
  fs.writeFileSync(path.join(__dirname, 'xl-cpu.json'), JSON.stringify({
    chainId: 196, factory: FACTORY, deployTx: tx.hash, blockNumber: rc.blockNumber,
    transistors, circuits, name: NAME, symbol: SYMBOL, supply: SUPPLY.toString(), mintPrice: PRICE,
    owner: wallet.address, deployedAt: new Date().toISOString(),
  }, null, 2));
  console.log('已写入 xl-cpu.json');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
