# Tạo 3 khóa mainnet cho SafeStreak — Hướng dẫn

> ⚠️ NGUYÊN TẮC AN TOÀN — đọc trước khi làm
> - Không ai — kể cả Muse, kể cả mình — được xem seed phrase / private key của anh.
> - Không chụp ảnh seed, không lưu cloud / Drive / Notes online, không dán vào chat, email hay AI.
> - Seed chép tay hoặc khắc kim loại, cất ở 2 nơi khác nhau.
> - 3 vai trò dùng 3 địa chỉ riêng, tách khỏi ví deploy tạm và ví cá nhân chính của anh.
> - File này chỉ ghi ĐỊA CHỈ (public), không bao giờ ghi seed / private key vào đây.

BRD tham chiếu: mục Quản lý khóa. Owner là Safe 2-of-3, publisher và verifier theo bảng dưới.

## Tổng quan 3 vai trò

| Vai trò | Dùng để làm gì | Tần suất | Nếu lộ khóa | Cách giữ |
| --- | --- | --- | --- | --- |
| Owner (Safe 2-of-3) | Đổi publisher/verifier, pause publishing | Vài lần cả kỳ thi | Mất kiểm soát dự án | Safe 2-of-3: ví cứng + MetaMask điện thoại + ví dự phòng offline |
| Publisher | Đăng thử thách + công bố đáp án, 2 giao dịch/ngày | Mỗi ngày | Đăng thử thách/đáp án giả cho đến khi owner thay | Ví cứng thứ hai, hoặc ví phần mềm trên profile trình duyệt riêng, không cài extension khác |
| Verifier | Ký xác nhận revoke (EIP-712), không gửi giao dịch | Mỗi lần có attestation | Ký xác nhận revoke giả | Khóa trong secret của Render (biến môi trường), không lưu trong code |

## Bước 1 — Chuẩn bị 3 ví ký cho Safe (owner)

Safe 2-of-3 cần 3 địa chỉ ký khác nhau, bất kỳ 2 trong 3 ký là đủ thực hiện giao dịch.

Gợi ý theo BRD:
1. **Ví cứng** (Ledger / Trezor, nếu anh có) — ký chính.
2. **MetaMask trên điện thoại** — tạo ví mới hoàn toàn, chỉ dùng cho SafeStreak.
3. **Ví dự phòng offline** — tạo ví mới trên máy không dùng thường xuyên, hoặc ví cứng thứ hai, cất seed riêng.

Nếu anh chưa có ví cứng: dùng 3 ví phần mềm riêng biệt cũng được cho kỳ thi, nhưng phải tách profile/thiết bị, không dùng chung ví cá nhân chính.

- [x] Đã có địa chỉ ký 1 (MetaMask điện thoại, 20/11/2026): 0x02ab630a00C1FA3251720FA9E59B0B72782ee91e — đã kiểm tra trên BNB mainnet: ví thường (không phải contract), số dư 0 BNB, nonce 0, ví mới.
- [x] Đã có địa chỉ ký 2 (MetaMask Chrome, 20/11/2026): 0xcf21E366BAb5105bE7636ab017A748fa41247F13 — đã kiểm tra trên BNB mainnet: ví thường, khác ví ký 1, số dư 0 BNB, nonce 0, ví mới.
- [x] Đã có địa chỉ ký 3 (gửi 20/11/2026): 0xcA33cedDd877eA00770C173Aa222cB9e296c139E — đã kiểm tra trên BNB mainnet, ví này nonce = 41 (đã gửi 41 giao dịch trước đây), số dư 0 BNB, KHÔNG phải ví mới hoàn toàn. Dũng quyết định giữ ví này làm ví ký 3 ngày 20/11.

## Bước 2 — Tạo Safe 2-of-3 trên BNB Chain

1. Mở https://app.safe.global — chọn mạng **BNB Smart Chain**.
2. Create new Safe → nhập 3 địa chỉ ký ở Bước 1 → Threshold đặt **2 of 3**.
3. Đặt tên Safe, ví dụ `SafeStreak Owner`.
4. Tạo Safe bằng 1 trong 3 ví ký (trả gas BNB mainnet, phí tạo Safe nhỏ).
5. Ghi lại địa chỉ Safe — đây là `OWNER` lúc deploy contract.

- [x] Địa chỉ Safe (OWNER): 0x4B49e3ec5DA3A4152033e85C932401c475056dAa — tạo xong 20/11/2026 15:22 +07, block 134662438, tx 0x867ac351b75b3de0b33a03316db3c5b73b29596d6946613b8f650509f8ac8d32, phí 0.0000153088 BNB, Safe 1.5.0+L2. Đã kiểm tra on-chain: đúng 3 owners (0x02ab…ee91e, 0xcf21…47F13, 0xcA33…139E), threshold 2.
- [ ] Đã test: 2 trong 3 ví ký được 1 giao dịch test của Safe (ví dụ đổi tên / gửi 0 BNB cho chính Safe).

## Bước 3 — Tạo ví Publisher

1. Tạo ví mới hoàn toàn, tách khỏi 3 ví ký ở trên và ví cá nhân.
   - Ưu tiên: ví cứng thứ hai.
   - Nếu dùng phần mềm: tạo trên profile trình duyệt riêng, không cài extension lạ.
2. Lưu seed theo nguyên tắc ở đầu file.
3. Nạp BNB mainnet đủ gas khoảng 1 tuần: 2 giao dịch/ngày × ~10 ngày. Ước tính gas mỗi giao dịch ~0.00001–0.00003 BNB (theo BRD, đo lại trên testnet), nạp dư một ít, ví dụ 0.01 BNB là đủ dư cho cả kỳ + dự phòng.
4. Ghi lại địa chỉ — đây là `PUBLISHER` lúc deploy.

- [x] Địa chỉ Publisher: 0x74033AA6bc21A137a8545A04170AB977A729Dc49 — tạo bởi Muse ngày 20/11/2026 theo yêu cầu của Dũng (anh nói mệt, nhờ tạo hộ). Private key CHỈ lưu ở ~/workspace/safestreak/hidden_files/publisher-wallet.json (mode 0600, ngoài repo), không ghi trong chat hay file này. Đã kiểm tra: ví mới, số dư 0 BNB, nonce 0. Lưu ý: vì khóa này do Muse tạo nên Muse biết khóa — chỉ nạp gas ~0.01 BNB, không để tiền lớn, sau kỳ thi đổi Publisher khác bằng Safe Owner.
- [x] Đã nạp BNB gas: 0.001 BNB, kiểm tra 20/11/2026 15:27 +07. Ước tính đủ cho ~20 giao dịch publish/reveal (mỗi giao dịch ~0.00002 BNB theo testnet), nhưng biên dự phòng mỏng nếu gas tăng — nên nạp thêm lên 0.005–0.01 BNB cho an toàn.

## Bước 4 — Tạo khóa Verifier

1. Tạo ví/key mới hoàn toàn, tách khỏi tất cả ví trên. Khóa này **chỉ ký, không gửi giao dịch**, nên không cần nạp BNB (số dư 0).
2. Cách tạo an toàn nhất cho kỳ thi:
   - Tạo bằng `cast wallet new` trên máy của anh, hoặc tạo ví mới trong MetaMask rồi export private key **chỉ để dán vào Render secret** (xem Bước 5).
   - Không lưu private key vào file code, repo, chat hay ảnh chụp.
3. Ghi lại **địa chỉ** (không ghi private key) — đây là `VERIFIER` lúc deploy.

- [x] Địa chỉ Verifier: 0x1Fc6e7764059B3206eD9D146d3F923233D6e3Be1 — tạo bởi Muse ngày 20/11/2026 (cùng cách như Publisher, vì Dũng mệt và nhờ tạo hộ). Private key CHỈ lưu ở ~/workspace/safestreak/hidden_files/verifier-wallet.json (mode 0600, ngoài repo), không ghi trong chat hay file này. Đã kiểm tra: ví mới, số dư 0 BNB, nonce 0 — đúng, Verifier chỉ ký, không gửi giao dịch, không cần nạp BNB. Sau này dán private key vào Render secret VERIFIER_PRIVATE_KEY, không commit vào repo.

## Bước 5 — Đưa khóa Verifier lên Render (làm sau, khi deploy verifier)

1. Deploy verifier lên Render theo `verifier/README.md`.
2. Trong Render → Environment, thêm biến `VERIFIER_PRIVATE_KEY` = private key ở Bước 4.
3. Không commit biến này vào repo, không để trong file `.env` rồi push.
4. Kiểm tra: verifier chỉ trả chữ ký qua `POST /attest`, không bao giờ in private key ra log.

## Bước 6 — Ví deploy tạm (dùng 1 lần lúc deploy mainnet)

1. Tạo ví tạm mới, nạp vừa đủ gas deploy (ước tính < 0.01 BNB).
2. Deploy contract bằng ví tạm, truyền `OWNER` = địa chỉ Safe ở Bước 2.
3. Sau khi deploy + verify xong, ví tạm không còn quyền gì — không cần giữ tiền trong đó.

- [ ] Địa chỉ ví deploy tạm: ____________________

## Checklist trước khi deploy mainnet

- [ ] Đã có đủ 3 địa chỉ: OWNER (Safe), PUBLISHER, VERIFIER
- [ ] Seed của từng ví đã chép tay / khắc kim loại, cất 2 nơi, không lưu online
- [ ] Không có private key / seed nào trong repo, chat, ảnh hay file cloud
- [ ] Publisher đã nạp đủ gas, Verifier số dư 0 (chỉ ký)
- [ ] Đã test Safe ký được với threshold 2-of-3

## Điền vào lệnh deploy (khi đủ 3 địa chỉ)

```bash
export AGENT_ID=0x60b9262456de011f7d15a54cdd8c48baaa8b022f
export OWNER=<địa chỉ Safe ở Bước 2>
export PUBLISHER=<địa chỉ ở Bước 3>
export VERIFIER=<địa chỉ ở Bước 4>

forge script script/Deploy.s.sol --rpc-url $BNB_RPC_URL --broadcast
```

Sau deploy, ghi địa chỉ SafeStreak + SNAPSHOT_BLOCK vào `TESTNET.md` (đổi tên thành mainnet) và BRD.
