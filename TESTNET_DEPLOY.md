# SafeStreak — Testnet deploy runbook (BSC Testnet, chain 97)

Chuẩn bị ngày 20/11/2026 (14:45 giờ Việt Nam). Chỉ dùng cho testnet — không
dùng ví, khóa hay địa chỉ nào trong file này cho mainnet.

## Trạng thái lúc viết

- Ví deploy test mới: `0xBf8B6D020C7f74F3B4bFeE3cBD84649ee936b9Ab` (tạo
  20/11, Dũng chọn "tạo ví mới"). Số dư kiểm tra lúc 14:39 VN là **0 tBNB**.
  Private key chỉ lưu trong `hidden_files/test-deployer-wallet.json` trên
  Muse — không gửi qua chat, không commit vào repo.
- Muse đang thử xin tBNB qua trình duyệt cho ví này (Dũng dặn lúc 14:40 VN).
  Nếu faucet bắt captcha tay thì Dũng tự làm bước đó.
- Code đã xong: `forge test` 31 passed, frontend build passes
  (kiểm tra 20/11). Chưa deploy lên testnet lần nào.

## Mạng testnet (đã kiểm chứng 20/11)

| Mục | Giá trị |
| --- | --- |
| Chain ID | 97 |
| RPC công khai | `https://bnb-testnet.api.onfinality.io/public` |
| Explorer | `https://testnet.bscscan.com` |
| Faucet | `https://testnet.bnbchain.org/faucet-smart` (thường 0,1 tBNB/ngày, đủ deploy thử vài contract) |

Kiểm tra số dư trước khi deploy: mở
`https://testnet.bscscan.com/address/0xBf8B6D020C7f74F3B4bFeE3cBD84649ee936b9Ab`
hoặc `cast balance <địa chỉ> --rpc-url https://bnb-testnet.api.onfinality.io/public`.

## Việc còn thiếu trước khi chạy deploy: MockAgentID chưa deploy được

- Contract chính trỏ tới Agent ID mainnet
  `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`, không có trên testnet.
- Cách làm thử đúng (Dũng đã đồng ý hướng này): deploy 1 contract Agent ID
  giả (mock) lên testnet, mint vài Agent ID test, rồi deploy SafeStreak trỏ
  tới mock đó. Code SafeStreak không đổi, chỉ đổi địa chỉ Agent ID lúc deploy.
- **Khoảng trống hiện tại:** `MockAgentID` chỉ tồn tại trong
  `contracts/test/SafeStreak.t.sol` (dùng cho `forge test`), không có trong
  `src/` và `script/Deploy.s.sol` chỉ deploy SafeStreak, không deploy mock.
  Cần thêm 1 script deploy mock (deploy `MockAgentID`, gọi `setBalance`
  cho ví test) rồi mới chạy `Deploy.s.sol` với `AGENT_ID` = địa chỉ mock.
- Vai trò trên testnet: dùng tạm địa chỉ ví test cho cả OWNER / PUBLISHER /
  VERIFIER (chỉ để thử). Mainnet phải dùng Safe 2-of-3 + ví riêng, xem
  `README.md` mục Deploy.

## Lệnh deploy (chạy sau khi có tBNB và có script mock)

```bash
cd ~/workspace/safestreak/contracts

# 1. Dry-run trước, không broadcast
AGENT_ID=<dia-chi-mock-agent-id> OWNER=<vi-test> PUBLISHER=<vi-test> VERIFIER=<vi-test> \
  forge script script/Deploy.s.sol \
  --rpc-url https://bnb-testnet.api.onfinality.io/public

# 2. Deploy thật lên testnet (khóa deployer truyền qua CLI, không ghi vào code)
AGENT_ID=<dia-chi-mock-agent-id> OWNER=<vi-test> PUBLISHER=<vi-test> VERIFIER=<vi-test> \
  forge script script/Deploy.s.sol \
  --rpc-url https://bnb-testnet.api.onfinality.io/public --broadcast
```

Script in ra địa chỉ SafeStreak, địa chỉ Badge và `SNAPSHOT_BLOCK` — ghi lại
3 số này vào BRD/README, không deploy lại nếu chỉ để thử commit/reveal.

Verify trên testnet BscScan sau khi deploy (cần `BSCSCAN_API_KEY` cho testnet):

```bash
forge verify-contract <dia-chi-SafeStreak> src/SafeStreak.sol:SafeStreak \
  --chain 97 --etherscan-api-key $BSCSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address)" \
      $AGENT_ID $OWNER $PUBLISHER $VERIFIER)
```

## Smoke test commit–reveal trên testnet

`dayId` trong contract = số ngày kể từ epoch (UTC), **không phải** số thứ tự
1–10: hôm nay 20/11/2026 = 20777; 21/11 = 20778; 27/11 = 20784;
06/12 = 20793.

- Publish phải gọi **trước 00:00 UTC** của ngày đó. Ví dụ thử ngày 21/11:
  publish `dayId` 20778 trước 21/11 00:00 UTC (07:00 VN 21/11).
- Commit trong ngày 21/11 (chỉ ví đã `setBalance` mock Agent ID mới commit
  được), dùng `contentHash`/`answerCommit` tính từ `questions/hash.mjs`.
- `revealAnswer` sau 22/11 00:00 UTC, rồi `reveal` trong 36 giờ sau đó
  (trước 23/11 12:00 UTC).
- Kiểm tra: `profile`, `points`, `bestCorrectStreak` đổi đúng; thử
  `claimBadge` nhánh join sau khi đủ streak 3 ngày thì cần 3 ngày thử liên
  tiếp — không bắt buộc trong lần smoke test đầu.

## Chú ý: `answerCommit` đang tính sai `dayId`

Xem mục riêng trong checklist chính / ghi chú mix-up ngày 20/11:
`questions/hash.mjs` và `questions/README.md` đang tính `answerCommit` với
`dayId` = số thứ tự ngày 1–10, trong khi `publishChallenge` trên chain nhận
`dayId` epoch (20784 cho 27/11). Contract không kiểm tra `answerCommit`
on-chain nên không chặn deploy, nhưng sau reveal sẽ không đối soát được
cam kết theo `dayId` trên chain. **Sửa trước lần publish đầu tiên:**
dùng `dayId` epoch khi tính `answerCommit` (ngày 1 → 20784, …, ngày 10 →
20793), và sửa dòng mô tả `dayId` trong `questions/README.md`.
