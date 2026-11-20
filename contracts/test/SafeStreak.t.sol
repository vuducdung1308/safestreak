// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {SafeStreak} from "../src/SafeStreak.sol";
import {Badge} from "../src/Badge.sol";

// --- Mocks ---

contract MockAgentID {
    mapping(address => uint256) public balances;
    mapping(address => string) public handles;

    function setBalance(address user, uint256 amount) external {
        balances[user] = amount;
    }

    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }

    function handleOf(address user) external view returns (string memory) {
        return handles[user];
    }
}

/// @notice Minimal ERC-20 allowance mock.
/// NOTE: allowance() reverts for a pair that was NEVER approved. A standard
/// ERC-20 returns 0 for never-approved pairs, which is indistinguishable
/// on-chain from a revoked approval — so on mainnet the verifier service
/// must reject never-approved pairs off-chain from approval history
/// (approvalBlock + revokeTxHash). This mock exercises the contract's
/// "allowance staticcall fails -> revert" path (test A1).
contract MockERC20 {
    mapping(address => mapping(address => uint256)) public allowanceMap;
    mapping(address => mapping(address => bool)) public everApproved;

    function approve(address spender, uint256 amount) external returns (bool) {
        allowanceMap[msg.sender][spender] = amount;
        if (amount > 0) everApproved[msg.sender][spender] = true;
        return true;
    }

    function allowance(address owner_, address spender) external view returns (uint256) {
        if (!everApproved[owner_][spender]) revert("never approved");
        return allowanceMap[owner_][spender];
    }
}

contract SafeStreakTest is Test {
    uint256 constant DAY0 = 20000;
    uint256 constant BASE = DAY0 * 86400; // 00:00 UTC of day 20000
    bytes32 constant SALT = bytes32(uint256(0xCAFE));

    MockAgentID agentId;
    MockERC20 tokenA;
    MockERC20 tokenB;
    SafeStreak streak;

    address owner = makeAddr("owner");
    address publisher = makeAddr("publisher");
    uint256 verifierPk = 0xBEEF;
    address verifier;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol"); // no Agent ID
    address spender1 = makeAddr("spender1");
    address spender2 = makeAddr("spender2");

    bytes32 constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address user,address token,address spender,uint64 approvalBlock,bytes32 revokeTxHash,uint256 nonce,uint64 deadline)"
    );

    function setUp() public {
        verifier = vm.addr(verifierPk);
        agentId = new MockAgentID();
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        // Day 19999, 12:00 UTC — before day 20000 starts, so we can publish it.
        vm.warp(BASE - 12 hours);
        streak = new SafeStreak(address(agentId), owner, publisher, verifier);
        agentId.setBalance(alice, 1);
        agentId.setBalance(bob, 1);
    }

    // --- Helpers ---

    function _publish(uint256 dayId, string memory answer) internal {
        vm.prank(publisher);
        streak.publishChallenge(dayId, keccak256(abi.encodePacked("content", dayId)), keccak256(bytes(answer)));
    }

    function _publishRange(uint256 from, uint256 to, string memory answer) internal {
        vm.startPrank(publisher);
        for (uint256 d = from; d <= to; d++) {
            streak.publishChallenge(d, keccak256(abi.encodePacked("content", d)), keccak256(bytes(answer)));
        }
        vm.stopPrank();
    }

    function _commitHash(uint256 dayId, string memory answer, bytes32 salt, address user)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(dayId, answer, salt, user));
    }

    function _commit(address user, uint256 dayId, string memory answer, bytes32 salt) internal {
        vm.prank(user);
        streak.commit(dayId, _commitHash(dayId, answer, salt, user));
    }

    function _publishAnswer(uint256 dayId, string memory answer) internal {
        vm.prank(publisher);
        streak.revealAnswer(dayId, answer);
    }

    function _reveal(address user, uint256 dayId, string memory answer, bytes32 salt) internal {
        vm.prank(user);
        streak.reveal(dayId, answer, salt);
    }

    /// @notice Play one full day correctly: commit today, then next day 01:00
    /// the publisher reveals the answer and the user reveals it.
    function _playDayCorrect(address user, uint256 dayId, string memory answer) internal {
        _commit(user, dayId, answer, SALT);
        vm.warp((dayId + 1) * 86400 + 3600);
        _publishAnswer(dayId, answer);
        _reveal(user, dayId, answer, SALT);
    }

    /// @notice Play one day with a wrong answer (commit "A", publisher answer "B").
    function _playDayWrong(address user, uint256 dayId) internal {
        _commit(user, dayId, "A", SALT);
        vm.warp((dayId + 1) * 86400 + 3600);
        _publishAnswer(dayId, "B");
        _reveal(user, dayId, "A", SALT);
    }

    function _profile(address user) internal view returns (SafeStreak.UserProfile memory) {
        (
            uint256 points_,
            uint256 joinStreak_,
            uint256 bestJoinStreak_,
            uint256 lastJoinDay_,
            uint256 correctStreak_,
            uint256 bestCorrectStreak_,
            uint256 bestCorrectAt_,
            uint256 lastCorrectDay_,
            uint256 lastRevealDay_
        ) = streak.profile(user);
        return SafeStreak.UserProfile({
            points: points_,
            joinStreak: joinStreak_,
            bestJoinStreak: bestJoinStreak_,
            lastJoinDay: lastJoinDay_,
            correctStreak: correctStreak_,
            bestCorrectStreak: bestCorrectStreak_,
            bestCorrectAt: bestCorrectAt_,
            lastCorrectDay: lastCorrectDay_,
            lastRevealDay: lastRevealDay_
        });
    }

    // --- Attestation helpers ---

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256(bytes("SafeStreak")), keccak256(bytes("1")), block.chainid, address(streak)
            )
        );
    }

    function _signAttestation(
        address user,
        address token,
        address spender,
        uint64 approvalBlock,
        bytes32 revokeTxHash,
        uint256 nonce,
        uint64 deadline
    ) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                keccak256(
                    abi.encode(
                        ATTESTATION_TYPEHASH, user, token, spender, approvalBlock, revokeTxHash, nonce, deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(verifierPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _approveAndRevoke(MockERC20 token, address user, address spender) internal {
        vm.startPrank(user);
        token.approve(spender, 100);
        token.approve(spender, 0);
        vm.stopPrank();
    }

    function _attestOk(address user, MockERC20 token, address spender) internal {
        _approveAndRevoke(token, user, spender);
        uint64 deadline = uint64(block.timestamp + 900);
        uint256 nonce = streak.nonces(user);
        bytes memory sig =
            _signAttestation(user, address(token), spender, 0, bytes32(uint256(0xABC)), nonce, deadline);
        vm.prank(user);
        streak.attest(user, address(token), spender, 0, bytes32(uint256(0xABC)), nonce, deadline, sig);
    }

    // ============ T1–T12: streaks ============

    function test_T1_Commit2359Then0000_Streak2() public {
        _publishRange(DAY0, DAY0 + 1, "B");
        vm.warp(DAY0 * 86400 + 23 hours + 59 minutes);
        _commit(alice, DAY0, "B", SALT);
        vm.warp((DAY0 + 1) * 86400); // 00:00 next day
        _commit(alice, DAY0 + 1, "B", SALT);
        assertEq(_profile(alice).joinStreak, 2);
        assertEq(_profile(alice).bestJoinStreak, 2);
    }

    function test_T2_DoubleCommitReverts() public {
        _publish(DAY0, "B");
        vm.warp(DAY0 * 86400 + 10 hours);
        _commit(alice, DAY0, "B", SALT);
        vm.expectRevert(SafeStreak.AlreadyCommitted.selector);
        vm.prank(alice);
        streak.commit(DAY0, _commitHash(DAY0, "B", SALT, alice));
    }

    function test_T3_SkipDayResetsJoinStreak() public {
        _publishRange(DAY0, DAY0 + 2, "B");
        vm.warp(DAY0 * 86400 + 10 hours);
        _commit(alice, DAY0, "B", SALT);
        vm.warp((DAY0 + 2) * 86400 + 10 hours); // skip DAY0+1 entirely
        _commit(alice, DAY0 + 2, "B", SALT);
        assertEq(_profile(alice).joinStreak, 1);
        assertEq(_profile(alice).bestJoinStreak, 1);
    }

    function test_T4_PublisherSkipsDay_StreakSurvives() public {
        _publish(DAY0, "B");
        _publish(DAY0 + 2, "B"); // no challenge for DAY0+1
        assertEq(streak.prevPublishedDay(DAY0 + 2), DAY0);
        vm.warp(DAY0 * 86400 + 10 hours);
        _commit(alice, DAY0, "B", SALT);
        vm.warp((DAY0 + 2) * 86400 + 10 hours);
        _commit(alice, DAY0 + 2, "B", SALT);
        assertEq(_profile(alice).joinStreak, 2);
    }

    function test_T5_CommitBeforeChallengeReverts() public {
        vm.warp(DAY0 * 86400 + 10 hours);
        vm.expectRevert(SafeStreak.ChallengeNotFound.selector);
        vm.prank(alice);
        streak.commit(DAY0, _commitHash(DAY0, "B", SALT, alice));
    }

    function test_T6_WrongAnswerResetsCorrectNotJoin() public {
        _publishRange(DAY0, DAY0 + 2, "B");
        vm.warp(DAY0 * 86400 + 3600);
        _playDayCorrect(alice, DAY0, "B");
        _playDayCorrect(alice, DAY0 + 1, "B");
        assertEq(_profile(alice).correctStreak, 2);
        assertEq(_profile(alice).joinStreak, 2);
        assertEq(streak.points(alice), 2);
        _playDayWrong(alice, DAY0 + 2);
        SafeStreak.UserProfile memory p = _profile(alice);
        assertEq(p.correctStreak, 0, "correct streak resets");
        assertEq(p.bestCorrectStreak, 2, "best correct streak kept");
        assertEq(p.joinStreak, 3, "join streak untouched");
        assertEq(streak.points(alice), 2, "no point for wrong answer");
    }

    function test_T7_LatePublisherRevealWithin36h() public {
        _publish(DAY0, "B");
        vm.warp(DAY0 * 86400 + 10 hours);
        _commit(alice, DAY0, "B", SALT);
        vm.warp((DAY0 + 1) * 86400 + 20 hours); // publisher reveals late, next day 20:00
        _publishAnswer(DAY0, "B");
        _reveal(alice, DAY0, "B", SALT);
        assertEq(streak.points(alice), 1);
        assertEq(_profile(alice).correctStreak, 1);
    }

    function test_T8_RevealAfter36hReverts() public {
        _publish(DAY0, "B");
        vm.warp(DAY0 * 86400 + 10 hours);
        _commit(alice, DAY0, "B", SALT);
        vm.warp((DAY0 + 1) * 86400 + 3600);
        _publishAnswer(DAY0, "B");
        (, , , uint64 revealedAt, ) = streak.getChallenge(DAY0);
        vm.warp(uint256(revealedAt) + 36 hours + 1);
        vm.expectRevert(SafeStreak.RevealWindowExpired.selector);
        vm.prank(alice);
        streak.reveal(DAY0, "B", SALT);
    }

    function test_T9_OutOfOrderRevealReverts() public {
        _publishRange(DAY0, DAY0 + 1, "B");
        vm.warp(DAY0 * 86400 + 10 hours);
        _commit(alice, DAY0, "B", SALT);
        vm.warp((DAY0 + 1) * 86400 + 10 hours);
        _commit(alice, DAY0 + 1, "B", SALT);
        vm.warp((DAY0 + 2) * 86400 + 3600);
        _publishAnswer(DAY0, "B");
        _publishAnswer(DAY0 + 1, "B");
        _reveal(alice, DAY0 + 1, "B", SALT); // reveal the later day first: allowed
        vm.expectRevert(SafeStreak.OutOfOrderReveal.selector);
        vm.prank(alice);
        streak.reveal(DAY0, "B", SALT); // going back to the earlier day reverts
    }

    function test_T10_WrongHashReverts() public {
        _publish(DAY0, "B");
        vm.warp(DAY0 * 86400 + 10 hours);
        _commit(alice, DAY0, "B", SALT); // committed hash of "B"
        vm.warp((DAY0 + 1) * 86400 + 3600);
        _publishAnswer(DAY0, "B");
        vm.expectRevert(SafeStreak.WrongCommitment.selector);
        vm.prank(alice);
        streak.reveal(DAY0, "C", SALT); // different answer -> hash mismatch
        vm.expectRevert(SafeStreak.WrongCommitment.selector);
        vm.prank(alice);
        streak.reveal(DAY0, "B", bytes32(uint256(0x9999))); // right answer, wrong salt
    }

    function test_T11_ClaimBadge7AfterStreakBroken() public {
        _publishRange(DAY0, DAY0 + 7, "B");
        vm.warp(DAY0 * 86400 + 3600);
        for (uint256 d = DAY0; d <= DAY0 + 6; d++) {
            _playDayCorrect(alice, d, "B");
        }
        assertEq(_profile(alice).bestCorrectStreak, 7);
        _playDayWrong(alice, DAY0 + 7); // break the streak
        assertEq(_profile(alice).correctStreak, 0);
        assertEq(_profile(alice).bestCorrectStreak, 7);

        // Best streak still qualifies: claim milestone 7.
        vm.prank(alice);
        uint256 tokenId = streak.claimBadge(1, 7);
        assertEq(tokenId, 1);
        assertEq(Badge(address(streak.badge())).ownerOf(tokenId), alice);

        // Second claim of the same (branch, milestone) reverts.
        vm.expectRevert(SafeStreak.BadgeAlreadyClaimed.selector);
        vm.prank(alice);
        streak.claimBadge(1, 7);

        // Other milestones / the join branch are independent claims.
        vm.prank(alice);
        streak.claimBadge(1, 3);
        vm.prank(alice);
        streak.claimBadge(0, 7); // join streak is 8 by now
    }

    function test_T11_ClaimBadgeTooLowReverts() public {
        vm.expectRevert(SafeStreak.StreakTooLow.selector);
        vm.prank(bob);
        streak.claimBadge(1, 3);
    }

    function test_T12_PublisherRevealSameDayReverts() public {
        _publish(DAY0, "B");
        vm.warp(DAY0 * 86400 + 10 hours); // still day DAY0
        vm.expectRevert(SafeStreak.RevealTooEarly.selector);
        vm.prank(publisher);
        streak.revealAnswer(DAY0, "B");
    }

    // ============ Extra streak / view checks ============

    function test_StaleStreakViewReturnsZero() public {
        _publishRange(DAY0, DAY0 + 1, "B");
        vm.warp(DAY0 * 86400 + 10 hours);
        _commit(alice, DAY0, "B", SALT);
        assertEq(streak.currentJoinStreak(alice), 1);
        // Day DAY0+1 has now ended without a commit from alice.
        vm.warp((DAY0 + 2) * 86400 + 3600);
        assertEq(streak.currentJoinStreak(alice), 0, "stale join streak reads 0");
        assertEq(_profile(alice).joinStreak, 1, "stored streak is kept");
    }

    function test_BestCorrectAtOnlyMovesWhenBestIncreases() public {
        _publishRange(DAY0, DAY0 + 2, "B");
        vm.warp(DAY0 * 86400 + 3600);
        _playDayCorrect(alice, DAY0, "B");
        uint256 firstAt = _profile(alice).bestCorrectAt;
        assertGt(firstAt, 0);
        _playDayCorrect(alice, DAY0 + 1, "B"); // best 1 -> 2, bestCorrectAt moves
        assertGt(_profile(alice).bestCorrectAt, firstAt);
        uint256 secondAt = _profile(alice).bestCorrectAt;
        _playDayWrong(alice, DAY0 + 2); // streak broken, best stays 2
        assertEq(_profile(alice).bestCorrectAt, secondAt);
    }

    function test_BadgeSoulbound() public {
        _publishRange(DAY0, DAY0 + 2, "B");
        vm.warp(DAY0 * 86400 + 3600);
        _playDayCorrect(alice, DAY0, "B");
        _playDayCorrect(alice, DAY0 + 1, "B");
        _playDayCorrect(alice, DAY0 + 2, "B");
        vm.prank(alice);
        uint256 tokenId = streak.claimBadge(1, 3);
        Badge badge = Badge(address(streak.badge()));
        vm.expectRevert(Badge.Soulbound.selector);
        vm.prank(alice);
        badge.transferFrom(alice, bob, tokenId);
        vm.expectRevert(Badge.Soulbound.selector);
        vm.prank(alice);
        badge.approve(bob, tokenId);
    }

    // ============ Access control / safety ============

    function test_NonAgentIdRevertsOnAllWrites() public {
        _publish(DAY0, "B");
        vm.warp(DAY0 * 86400 + 10 hours);
        vm.expectRevert(SafeStreak.NotAgentId.selector);
        vm.prank(carol);
        streak.commit(DAY0, _commitHash(DAY0, "B", SALT, carol));
        vm.expectRevert(SafeStreak.NotAgentId.selector);
        vm.prank(carol);
        streak.reveal(DAY0, "B", SALT);
        vm.expectRevert(SafeStreak.NotAgentId.selector);
        vm.prank(carol);
        streak.claimBadge(0, 3);
        vm.expectRevert(SafeStreak.NotAgentId.selector);
        vm.prank(carol);
        streak.attest(carol, address(tokenA), spender1, 0, bytes32(0), 0, uint64(block.timestamp + 900), "");
    }

    function test_NonOwnerCannotSetPublisher() public {
        vm.expectRevert(SafeStreak.NotOwner.selector);
        vm.prank(alice);
        streak.setPublisher(bob);
        vm.expectRevert(SafeStreak.NotOwner.selector);
        vm.prank(alice);
        streak.setVerifier(bob);
        vm.expectRevert(SafeStreak.NotOwner.selector);
        vm.prank(alice);
        streak.pausePublishing();
    }

    function test_SendBNBReverts() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(streak).call{value: 0.1 ether}("");
        assertFalse(success, "contract has no receive/fallback, BNB must bounce");
    }

    function test_PauseBlocksPublisherOnly() public {
        _publish(DAY0, "B");
        vm.prank(owner);
        streak.pausePublishing();
        assertTrue(streak.publishingPaused());
        vm.expectRevert(SafeStreak.PublishingPaused.selector);
        vm.prank(publisher);
        streak.publishChallenge(DAY0 + 1, bytes32(0), bytes32(0));
        vm.expectRevert(SafeStreak.PublishingPaused.selector);
        vm.prank(publisher);
        streak.revealAnswer(DAY0, "B");
        // Users can still commit for an already-published day while paused.
        vm.warp(DAY0 * 86400 + 10 hours);
        _commit(alice, DAY0, "B", SALT);
        // Unpause (toggle) and publishing works again.
        vm.prank(owner);
        streak.pausePublishing();
        assertFalse(streak.publishingPaused());
        _publish(DAY0 + 1, "B");
    }

    // ============ A1–A8: attestations ============

    function test_A1_NeverApprovedPairReverts() public {
        // alice never approved tokenA -> spender1: mock allowance() reverts,
        // so the contract's staticcall fails -> AllowanceCheckFailed.
        uint64 deadline = uint64(block.timestamp + 900);
        bytes memory sig =
            _signAttestation(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline);
        vm.expectRevert(SafeStreak.AllowanceCheckFailed.selector);
        vm.prank(alice);
        streak.attest(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline, sig);
    }

    function test_A2_ApprovalAfterSnapshotReverts() public {
        _approveAndRevoke(tokenA, alice, spender1);
        uint64 approvalBlock = uint64(streak.SNAPSHOT_BLOCK()); // == snapshot, not before it
        uint64 deadline = uint64(block.timestamp + 900);
        bytes memory sig =
            _signAttestation(alice, address(tokenA), spender1, approvalBlock, bytes32(uint256(0xABC)), 0, deadline);
        vm.expectRevert(SafeStreak.ApprovalAfterSnapshot.selector);
        vm.prank(alice);
        streak.attest(alice, address(tokenA), spender1, approvalBlock, bytes32(uint256(0xABC)), 0, deadline, sig);
    }

    function test_A3_DoubleAttestSamePairReverts() public {
        _attestOk(alice, tokenA, spender1);
        _approveAndRevoke(tokenA, alice, spender1);
        uint64 deadline = uint64(block.timestamp + 900);
        uint256 nonce = streak.nonces(alice);
        bytes memory sig =
            _signAttestation(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), nonce, deadline);
        vm.expectRevert(SafeStreak.AlreadyAttested.selector);
        vm.prank(alice);
        streak.attest(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), nonce, deadline, sig);
    }

    function test_A4_ReplayedSignatureReverts() public {
        _approveAndRevoke(tokenA, alice, spender1);
        uint64 deadline = uint64(block.timestamp + 900);
        bytes memory sig =
            _signAttestation(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline);
        vm.prank(alice);
        streak.attest(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline, sig);
        // Replay the exact same signature: nonce already consumed.
        vm.expectRevert(SafeStreak.BadNonce.selector);
        vm.prank(alice);
        streak.attest(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline, sig);
    }

    function test_A4_ExpiredDeadlineReverts() public {
        _approveAndRevoke(tokenA, alice, spender1);
        uint64 deadline = uint64(block.timestamp - 1); // already expired
        bytes memory sig =
            _signAttestation(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline);
        vm.expectRevert(SafeStreak.DeadlineExpired.selector);
        vm.prank(alice);
        streak.attest(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline, sig);
    }

    function test_A4_DeadlineTooFarReverts() public {
        _approveAndRevoke(tokenA, alice, spender1);
        uint64 deadline = uint64(block.timestamp + 16 minutes); // beyond the 15-min window
        bytes memory sig =
            _signAttestation(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline);
        vm.expectRevert(SafeStreak.DeadlineTooFar.selector);
        vm.prank(alice);
        streak.attest(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline, sig);
    }

    function test_A5_SignatureForAnotherUserReverts() public {
        _approveAndRevoke(tokenA, bob, spender1);
        uint64 deadline = uint64(block.timestamp + 900);
        // Signature covers alice, but bob submits it as his own attestation.
        bytes memory sig =
            _signAttestation(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline);
        vm.expectRevert(SafeStreak.BadSignature.selector);
        vm.prank(bob);
        streak.attest(bob, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline, sig);
    }

    function test_A6_AllowanceNonZeroReverts() public {
        vm.startPrank(alice);
        tokenA.approve(spender1, 100); // approved, NOT revoked
        vm.stopPrank();
        uint64 deadline = uint64(block.timestamp + 900);
        bytes memory sig =
            _signAttestation(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline);
        vm.expectRevert(SafeStreak.AllowanceNotZero.selector);
        vm.prank(alice);
        streak.attest(alice, address(tokenA), spender1, 0, bytes32(uint256(0xABC)), 0, deadline, sig);
    }

    function test_A7_AcceptsAnyToken() public {
        // The contract accepts any token contract; the allowed-token list is
        // enforced off-chain by the verifier service (see README).
        _attestOk(alice, tokenA, spender1);
        _attestOk(alice, tokenB, spender1);
        assertTrue(streak.attested(alice, address(tokenA), spender1));
        assertTrue(streak.attested(alice, address(tokenB), spender1));
    }

    function test_A8_FourthAttestationSameDayReverts() public {
        _attestOk(alice, tokenA, spender1);
        _attestOk(alice, tokenA, spender2);
        _attestOk(alice, tokenB, spender1);
        // 4th attestation on the same day, with a fresh valid signature.
        _approveAndRevoke(tokenB, alice, spender2);
        uint64 deadline = uint64(block.timestamp + 900);
        uint256 nonce = streak.nonces(alice);
        bytes memory sig =
            _signAttestation(alice, address(tokenB), spender2, 0, bytes32(uint256(0xABC)), nonce, deadline);
        vm.expectRevert(SafeStreak.AttestationLimitReached.selector);
        vm.prank(alice);
        streak.attest(alice, address(tokenB), spender2, 0, bytes32(uint256(0xABC)), nonce, deadline, sig);
    }

    function test_AttestHappyPath() public {
        _attestOk(alice, tokenA, spender1);
        assertTrue(streak.attested(alice, address(tokenA), spender1));
        assertEq(streak.nonces(alice), 1);
        assertEq(streak.attestationsToday(alice, block.timestamp / 86400), 1);
    }
}
