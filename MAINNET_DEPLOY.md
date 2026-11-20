# Deploy mainnet SafeStreak — ĐÃ DEPLOY XONG 20/11/2026

## Kết quả deploy mainnet (chain 56, đã kiểm tra on-chain)

- **SafeStreak: 0xA1D5E01B04B6c8d398219bc84F5b2f28e295b28F**
- **Badge: 0xF1bC1504Dc3fF3A8039226961B4915890bcDBB4A**
- **SNAPSHOT_BLOCK: 134663434** (kiểm tra on-chain; log script in 134663422 là số block lúc mô phỏng, block thật lúc deploy là 134663434)
- Tx deploy: 0x51579b7e59bde518162c720b8a3bfff870160e4e1966dc1d836ba4622d21a7bc, block 134663434, status success
- BscScan: https://bscscan.com/address/0xA1D5E01B04B6c8d398219bc84F5b2f28e295b28F
- Đã kiểm tra on-chain: owner = Safe 0x4B49…56dAa, publisher = 0x7403…Dc49, verifier = 0x1Fc6…3Be1, agentId = 0x60b9262456de011f7d15a54cdd8c48baaa8b022f, badge = 0xF1bC…BB4A
- Phí deploy thực tế: 0.000144 BNB (ví deploy tạm còn 0.000856 BNB)
- Verify source: Sourcify exact_match cho cả SafeStreak và Badge ngày 20/11/2026 15:30 UTC (verifiedAt 08:30:46Z / 08:30:47Z). BscScan verify riêng vẫn chưa có — cần BscScan API key, hiện chưa có trong env.
- Frontend: đã điền VITE_SAFESTREAK_ADDRESS mainnet vào .env, `npm run build` pass, địa chỉ contract có trong bundle dist/. Chưa publish lên GitHub Pages — repo chưa có git, chưa có tài khoản GitHub kết nối trong Muse.
- Verifier: env Render đã chuẩn bị trong verifier/.env.render (SAFESTREAK_ADDRESS mainnet, SNAPSHOT_BLOCK cuối kỳ 09/12 chưa biết block, ACCEPTED_TOKENS chưa điền địa chỉ token mainnet đã verify — không bịa). Chưa deploy lên Render — cần tài khoản Render + repo GitHub.

## 3 địa chỉ đã chốt (mainnet, chain 56)

| Vai trò | Địa chỉ | Ghi chú |
| --- | --- | --- |
| OWNER (Safe 2-of-3) | 0x4B49e3ec5DA3A4152033e85C932401c475056dAa | Tạo 20/11, block 134662438, tx 0x867ac351b75b3de0b33a03316db3c5b73b29596d6946613b8f650509f8ac8d32 |
| PUBLISHER | 0x74033AA6bc21A137a8545A04170AB977A729Dc49 | Muse tạo hộ, key ở hidden_files/publisher-wallet.json, đã nạp 0.001 BNB (nên nạp thêm lên 0.005 BNB) |
| VERIFIER | 0x1Fc6e7764059B3206eD9D146d3F923233D6e3Be1 | Muse tạo hộ, key ở hidden_files/verifier-wallet.json, số dư 0, chỉ ký |
| AGENT_ID (mainnet) | 0x60b9262456de011f7d15a54cdd8c48baaa8b022f | Theo BRD, ERC-721 non-transferable |
| Ví deploy tạm | 0x114bA966FCdCc3e428c850261aF804A36434DA3c | Muse tạo, key ở hidden_files/mainnet-deployer-wallet.json, CHƯA nạp gas — cần nạp ~0.01 BNB trước khi deploy |

## Dữ liệu deploy cần lưu ở đâu?

### 1. On-chain (công khai, vĩnh viễn — không cần lưu thêm)
- Contract SafeStreak + Badge, SNAPSHOT_BLOCK (= block deploy), challenges, commits, reveals, streaks, badges.
- Đọc lại được từ RPC / BscScan bất cứ lúc nào.

### 2. Trong repo (công khai, KHÔNG chứa secret)
- Sau deploy, ghi vào file này + README + BRD: địa chỉ SafeStreak, Badge, SNAPSHOT_BLOCK, tx hash deploy, BscScan verify.
- `questions/questions.json` + contentHash đã có sẵn trong repo.
- Frontend config: địa chỉ contract, chain 56, ngày chạy 27/11–06/12.

### 3. Trong Muse hidden_files (riêng tư, KHÔNG commit vào repo)
- `hidden_files/mainnet-deployer-wallet.json` — key ví deploy tạm (dùng 1 lần).
- `hidden_files/publisher-wallet.json` — key Publisher.
- `hidden_files/verifier-wallet.json` — key Verifier.
- `hidden_files/mainnet-day-YYYYY.json` — salt từng ngày (tạo lúc publish thử thách, giống testnet day 20778). **Mất salt là không reveal được đáp án ngày đó**, nên phải lưu file này.
- Không bao giờ ghi private key / salt vào chat, repo, ảnh hay cloud.

### 4. Trên Render (secret, chỉ verifier)
- Biến môi trường `VERIFIER_PRIVATE_KEY` = private key Verifier.
- Danh sách địa chỉ token mainnet USDT/USDC/WBNB/BTCB/ETH/CAKE (điền khi deploy verifier).
- Không lưu dữ liệu người dùng ở Render — verifier chỉ ký, không lưu DB.

### 5. Không lưu gì thêm
- Không lưu dữ liệu cá nhân người dùng, không lưu số dư / tài sản, không lưu seed phrase của ai.
- Leaderboard tính off-chain từ event `Revealed` / `StreakUpdated`, không cần DB riêng.

## Lệnh deploy (chạy trên máy server của Dũng, sau khi nạp gas cho ví deploy tạm)

```bash
cd ~/workspace/safestreak/contracts

export BNB_RPC_URL=https://bsc-dataseed.binance.org/
export AGENT_ID=0x60b9262456de011f7d15a54cdd8c48baaa8b022f
export OWNER=0x4B49e3ec5DA3A4152033e85C932401c475056dAa
export PUBLISHER=0x74033AA6bc21A137a8545A04170AB977A729Dc49
export VERIFIER=0x1Fc6e7764059B3206eD9D146d3F923233D6e3Be1

# Dry-run trước (không broadcast, không tốn gas)
forge script script/Deploy.s.sol --rpc-url $BNB_RPC_URL

# Deploy thật (key deployer lấy từ hidden_files/mainnet-deployer-wallet.json, không paste vào chat)
forge script script/Deploy.s.sol --rpc-url $BNB_RPC_URL --broadcast --verify
```

Sau deploy, ghi địa chỉ SafeStreak + Badge + SNAPSHOT_BLOCK vào file này và BRD, verify trên BscScan.

## Việc còn kẹt trước deploy
- [ ] Nạp ~0.01 BNB mainnet vào ví deploy tạm 0x114bA966FCdCc3e428c850261aF804A36434DA3c
- [ ] (Khuyến nghị) Nạp thêm Publisher lên 0.005 BNB
- [ ] Deploy + verify BscScan trước 27/11
- [ ] Deploy frontend GitHub Pages + verifier Render, điền địa chỉ contract mainnet + token mainnet
