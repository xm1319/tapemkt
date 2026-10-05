/* 挂单工具：把 OrderGuard 电路挂到 XL 市场（非托管，买家 OKB 直付）
 * 用法: node xl-list.js <tokenId> <priceOKB> [名称]
 */
const { ethers } = require('ethers');
const fs = require('fs');

const PROC = '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355';
const API = 'http://127.0.0.1:8787';

function readKey() {
  if (process.env.KEY_FILE && fs.existsSync(process.env.KEY_FILE)) return fs.readFileSync(process.env.KEY_FILE, 'utf8');
  if (fs.existsSync('/root/secrets/signing.key')) return fs.readFileSync('/root/secrets/signing.key', 'utf8');
  return fs.readFileSync(__dirname + '/key.txt', 'utf8');
}

(async () => {
  const tokenId = Number(process.argv[2] || 1);
  const price = String(process.argv[3] || '0.01');
  const name = process.argv[4] || ('OrderGuard 电路 #' + tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1) throw new Error('tokenId 不合法');
  if (!/^\d+(\.\d+)?$/.test(price)) throw new Error('价格不合法');

  const raw = readKey();
  let m = raw.match(/^(0x)?([0-9a-fA-F]{64})$/m);
  if (!m) throw new Error('私钥文件格式异常');
  const w = new ethers.Wallet('0x' + m[2]);

  const p = new ethers.JsonRpcProvider('https://tapeout.net/rpc-xlayer');
  const owner = await new ethers.Contract(PROC, ['function ownerOf(uint256) view returns (address)'], p).ownerOf(tokenId);
  console.log('链上核验: 电路#' + tokenId + ' 持有人 =', owner);
  if (owner.toLowerCase() !== w.address.toLowerCase()) throw new Error('该电路不属于部署钱包，拒绝挂单');

  const ts = Date.now();
  const msg = 'TapeOut市场·挂单确认\n卖家: ' + w.address + '\n品种: ' + PROC + ' #' + tokenId + '\n数量: 1\n单价: ' + price + ' OKB\n时间: ' + ts;
  const sig = await w.signMessage(msg);
  const r = await fetch(API + '/api/mk/list', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain: 'xl', name, circuits: PROC, tokenId, qty: 1, priceBnb: price, seller: w.address, ts, sig }),
  });
  const j = await r.json();
  console.log('LIST:', r.status, JSON.stringify(j).slice(0, 220));
  if (j.ok) console.log('✅ 已挂出: ' + name + ' @ ' + price + ' OKB（单号 ' + j.id + '）');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
