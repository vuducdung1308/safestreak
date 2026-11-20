// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Badge} from "./Badge.sol";

/// @title SafeStreak
/// @notice Daily quiz streaks for Agent ID holders on BNB Chain.
/// - One challenge per day, published by `publisher` before 00:00 UTC.
/// - Users commit an answer hash during the day, then reveal after the
///   publisher reveals the answer (within a 36-hour window).
/// - Correct answers build a correct-answer streak; committing builds a
///   join streak. Best streaks unlock soulbound badges (3 / 7 / 14).
/// - Users can attest (via a verifier EIP-712 signature) that they had
///   approved and since revoked a token approval before SNAPSHOT_BLOCK.
/// - No token is issued by this contract. No payable functions: this
///   contract never accepts BNB.
interface IAgentID {
    function balanceOf(address account) external view returns (uint256);
    function handleOf(address account) external view returns (string memory);
}

interface IERC20 {
    function allowance(address owner, address spender) external view returns (uint256);
}

contract SafeStreak {
    // --- Errors ---
    error NotAgentId();
    error NotOwner();
    error NotPublisher();
    error PublishingPaused();
    error ChallengeExists();
    error ChallengeNotFound();
    error PublishTooLate();
    error RevealTooEarly();
    error AnswerAlreadyRevealed();
    error AnswerNotRevealed();
    error RevealWindowExpired();
    error NotCommitted();
    error AlreadyCommitted();
    error AlreadyRevealed();
    error OutOfOrderReveal();
    error WrongCommitment();
    error NotToday();
    error InvalidBranch();
    error InvalidMilestone();
    error BadgeAlreadyClaimed();
    error StreakTooLow();
    error NotUser();
    error DeadlineExpired();
    error DeadlineTooFar();
    error BadNonce();
    error BadSignature();
    error ApprovalAfterSnapshot();
    error AlreadyAttested();
    error AttestationLimitReached();
    error AllowanceNotZero();
    error AllowanceCheckFailed();
    error ZeroAddress();

    // --- Events ---
    event ChallengePublished(uint256 indexed dayId, bytes32 contentHash, bytes32 answerCommit);
    event AnswerRevealed(uint256 indexed dayId, string answer);
    event Committed(address indexed user, uint256 indexed dayId);
    event Revealed(address indexed user, uint256 indexed dayId, bool correct);
    event StreakUpdated(address indexed user, uint8 indexed branch, uint256 newStreak, uint256 bestStreak);
    event BadgeClaimed(address indexed user, uint8 branch, uint256 milestone, uint256 tokenId);
    event Attested(
        address indexed user,
        address indexed token,
        address indexed spender,
        uint64 approvalBlock,
        bytes32 revokeTxHash,
        address verifier
    );
    event RoleChanged(string role, address oldAddress, address newAddress);
    event PublishingPauseChanged(bool paused);

    // --- Constants ---
    uint256 public constant REVEAL_WINDOW = 36 hours;
    uint256 public constant VERIFIER_DEADLINE = 15 minutes;
    uint256 public constant MAX_ATTESTATIONS_PER_DAY = 3;
    uint8 public constant BRANCH_JOIN = 0;
    uint8 public constant BRANCH_CORRECT = 1;

    // EIP-712
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address user,address token,address spender,uint64 approvalBlock,bytes32 revokeTxHash,uint256 nonce,uint64 deadline)"
    );

    // --- Immutable config ---
    IAgentID public immutable agentId;
    address public immutable owner;
    /// @notice Block at deploy time. Attested approvals must predate it.
    uint256 public immutable SNAPSHOT_BLOCK;
    Badge public immutable badge;

    // --- Mutable roles ---
    address public publisher;
    address public verifier;

    /// @notice When true, publishChallenge / revealAnswer revert.
    /// Commit / reveal by users keep working for already-published days.
    bool public publishingPaused;

    // --- Challenges ---
    struct Challenge {
        bytes32 contentHash;
        bytes32 answerCommit;
        string answer;
        uint64 answerRevealedAt;
        bool exists;
    }

    mapping(uint256 => Challenge) public challenges;
    /// @notice Previous published day before `dayId` (0 if none).
    mapping(uint256 => uint256) public prevPublishedDay;
    uint256 public lastPublishedDay;

    // --- Users ---
    struct UserProfile {
        uint256 points; // total correct answers (1 correct answer = 1 point)
        uint256 joinStreak;
        uint256 bestJoinStreak;
        uint256 lastJoinDay;
        uint256 correctStreak;
        uint256 bestCorrectStreak;
        uint256 bestCorrectAt; // timestamp when bestCorrectStreak was first achieved
        uint256 lastCorrectDay;
        uint256 lastRevealDay;
    }

    struct Entry {
        bytes32 commitHash;
        bool revealed;
        bool correct;
        bool exists;
    }

    mapping(address => UserProfile) private _profiles;
    mapping(address => mapping(uint256 => Entry)) private _entries;

    // --- Badges ---
    mapping(address => mapping(uint8 => mapping(uint256 => bool))) public badgeClaimed;

    // --- Attestations ---
    mapping(address => mapping(address => mapping(address => bool))) public attested;
    mapping(address => mapping(uint256 => uint256)) public attestationsToday;
    mapping(address => uint256) public nonces;

    bytes32 private immutable _cachedDomainSeparator;
    uint256 private immutable _cachedChainId;

    // --- Modifiers ---
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPublisher() {
        if (msg.sender != publisher) revert NotPublisher();
        _;
    }

    modifier onlyAgentId() {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentId();
        _;
    }

    modifier whenPublishingNotPaused() {
        if (publishingPaused) revert PublishingPaused();
        _;
    }

    constructor(address agentId_, address owner_, address publisher_, address verifier_) {
        if (agentId_ == address(0) || owner_ == address(0) || publisher_ == address(0) || verifier_ == address(0)) {
            revert ZeroAddress();
        }
        agentId = IAgentID(agentId_);
        owner = owner_;
        publisher = publisher_;
        verifier = verifier_;
        SNAPSHOT_BLOCK = block.number;
        badge = new Badge(address(this));
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    // --- Publisher: challenges ---

    /// @notice Publish the challenge for `dayId` (days since epoch, UTC).
    /// Must be called before 00:00 UTC of `dayId`. Cannot overwrite.
    function publishChallenge(uint256 dayId, bytes32 contentHash, bytes32 answerCommit)
        external
        onlyPublisher
        whenPublishingNotPaused
    {
        if (block.timestamp >= dayId * 86400) revert PublishTooLate();
        if (challenges[dayId].exists) revert ChallengeExists();

        if (dayId > lastPublishedDay) {
            prevPublishedDay[dayId] = lastPublishedDay;
            lastPublishedDay = dayId;
        } else {
            // Out-of-order publish (same-day catch-up): find nearest published day below dayId.
            uint256 prev = 0;
            uint256 i = dayId;
            while (i > 0) {
                unchecked {
                    i -= 1;
                }
                if (challenges[i].exists) {
                    prev = i;
                    break;
                }
            }
            prevPublishedDay[dayId] = prev;
        }

        challenges[dayId] =
            Challenge({contentHash: contentHash, answerCommit: answerCommit, answer: "", answerRevealedAt: 0, exists: true});
        emit ChallengePublished(dayId, contentHash, answerCommit);
    }

    /// @notice Reveal the answer for `dayId`. Only once the day has passed.
    function revealAnswer(uint256 dayId, string calldata answer) external onlyPublisher whenPublishingNotPaused {
        Challenge storage c = challenges[dayId];
        if (!c.exists) revert ChallengeNotFound();
        if (block.timestamp / 86400 <= dayId) revert RevealTooEarly();
        if (c.answerRevealedAt != 0) revert AnswerAlreadyRevealed();
        c.answer = answer;
        c.answerRevealedAt = uint64(block.timestamp);
        emit AnswerRevealed(dayId, answer);
    }

    // --- Users: commit / reveal ---

    /// @notice Commit an answer hash for today's challenge. One per day.
    function commit(uint256 dayId, bytes32 commitHash) external onlyAgentId {
        if (!challenges[dayId].exists) revert ChallengeNotFound();
        if (dayId != block.timestamp / 86400) revert NotToday();
        if (_entries[msg.sender][dayId].exists) revert AlreadyCommitted();

        _entries[msg.sender][dayId] = Entry({commitHash: commitHash, revealed: false, correct: false, exists: true});

        UserProfile storage p = _profiles[msg.sender];
        if (p.lastJoinDay == prevPublishedDay[dayId]) {
            p.joinStreak += 1;
        } else {
            p.joinStreak = 1;
        }
        if (p.joinStreak > p.bestJoinStreak) p.bestJoinStreak = p.joinStreak;
        p.lastJoinDay = dayId;

        emit Committed(msg.sender, dayId);
        emit StreakUpdated(msg.sender, BRANCH_JOIN, p.joinStreak, p.bestJoinStreak);
    }

    /// @notice Reveal the committed answer. Must be in increasing day order,
    /// within 36 hours of the publisher's answer reveal.
    function reveal(uint256 dayId, string calldata answer, bytes32 salt) external onlyAgentId {
        Entry storage e = _entries[msg.sender][dayId];
        if (!e.exists) revert NotCommitted();
        if (e.revealed) revert AlreadyRevealed();

        Challenge storage c = challenges[dayId];
        if (!c.exists) revert ChallengeNotFound();
        if (c.answerRevealedAt == 0) revert AnswerNotRevealed();
        if (block.timestamp > uint256(c.answerRevealedAt) + REVEAL_WINDOW) revert RevealWindowExpired();

        UserProfile storage p = _profiles[msg.sender];
        if (dayId <= p.lastRevealDay) revert OutOfOrderReveal();
        if (keccak256(abi.encodePacked(dayId, answer, salt, msg.sender)) != e.commitHash) revert WrongCommitment();

        bool correct = keccak256(bytes(answer)) == keccak256(bytes(c.answer));
        e.revealed = true;
        e.correct = correct;
        p.lastRevealDay = dayId;

        if (correct) {
            p.points += 1;
            if (p.lastCorrectDay == prevPublishedDay[dayId]) {
                p.correctStreak += 1;
            } else {
                p.correctStreak = 1;
            }
            // bestCorrectAt only moves when the best increases (first achieved).
            if (p.correctStreak > p.bestCorrectStreak) {
                p.bestCorrectStreak = p.correctStreak;
                p.bestCorrectAt = block.timestamp;
            }
            p.lastCorrectDay = dayId;
        } else {
            // Wrong answer resets the correct streak; the join streak is untouched.
            p.correctStreak = 0;
        }

        emit Revealed(msg.sender, dayId, correct);
        emit StreakUpdated(msg.sender, BRANCH_CORRECT, p.correctStreak, p.bestCorrectStreak);
    }

    // --- Users: badges ---

    /// @notice Claim a soulbound badge for a best streak milestone (3 / 7 / 14).
    /// `branch` 0 = join streak, 1 = correct-answer streak.
    function claimBadge(uint8 branch, uint256 milestone) external onlyAgentId returns (uint256 tokenId) {
        if (branch > 1) revert InvalidBranch();
        if (milestone != 3 && milestone != 7 && milestone != 14) revert InvalidMilestone();

        UserProfile storage p = _profiles[msg.sender];
        uint256 best = branch == BRANCH_JOIN ? p.bestJoinStreak : p.bestCorrectStreak;
        if (best < milestone) revert StreakTooLow();
        if (badgeClaimed[msg.sender][branch][milestone]) revert BadgeAlreadyClaimed();

        badgeClaimed[msg.sender][branch][milestone] = true;
        tokenId = badge.mint(msg.sender, branch, milestone);
        emit BadgeClaimed(msg.sender, branch, milestone, tokenId);
    }

    // --- Users: attestations ---

    /// @notice Attest that `user` had approved `token` -> `spender` at
    /// `approvalBlock` (before SNAPSHOT_BLOCK) and has since revoked it
    /// (see `revokeTxHash`). Requires a verifier EIP-712 signature.
    /// The caller must be `user`. Current allowance must be 0.
    function attest(
        address user,
        address token,
        address spender,
        uint64 approvalBlock,
        bytes32 revokeTxHash,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external onlyAgentId {
        if (msg.sender != user) revert NotUser();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (deadline > block.timestamp + VERIFIER_DEADLINE) revert DeadlineTooFar();
        if (nonce != nonces[user]) revert BadNonce();

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
        if (_recover(digest, signature) != verifier) revert BadSignature();
        if (approvalBlock >= SNAPSHOT_BLOCK) revert ApprovalAfterSnapshot();
        if (attested[user][token][spender]) revert AlreadyAttested();

        uint256 today = block.timestamp / 86400;
        if (attestationsToday[user][today] >= MAX_ATTESTATIONS_PER_DAY) revert AttestationLimitReached();

        // Current allowance must be 0 (approval has been revoked).
        // The staticcall must succeed; a token without allowance() reverts here.
        (bool ok, bytes memory ret) =
            token.staticcall(abi.encodeWithSelector(IERC20.allowance.selector, user, spender));
        if (!ok || ret.length < 32) revert AllowanceCheckFailed();
        if (abi.decode(ret, (uint256)) != 0) revert AllowanceNotZero();

        nonces[user] += 1;
        attested[user][token][spender] = true;
        attestationsToday[user][today] += 1;

        emit Attested(user, token, spender, approvalBlock, revokeTxHash, verifier);
    }

    // --- Owner: roles / pause ---
    // NOTE: pausePublishing only pauses publishChallenge / revealAnswer.
    // Users can still commit / reveal for already-published days while paused.

    function setPublisher(address newPublisher) external onlyOwner {
        if (newPublisher == address(0)) revert ZeroAddress();
        emit RoleChanged("publisher", publisher, newPublisher);
        publisher = newPublisher;
    }

    function setVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert ZeroAddress();
        emit RoleChanged("verifier", verifier, newVerifier);
        verifier = newVerifier;
    }

    /// @notice Toggle the publishing pause (pause / unpause).
    function pausePublishing() external onlyOwner {
        publishingPaused = !publishingPaused;
        emit PublishingPauseChanged(publishingPaused);
    }

    // --- Views ---

    /// @notice Latest published day that has already ended (0 if none).
    function _latestEndedPublishedDay() internal view returns (uint256) {
        uint256 today = block.timestamp / 86400;
        if (lastPublishedDay == 0) return 0;
        if (lastPublishedDay < today) return lastPublishedDay;
        return prevPublishedDay[lastPublishedDay];
    }

    /// @notice Join streak, or 0 if the user missed the latest ended published day.
    function currentJoinStreak(address user) external view returns (uint256) {
        if (_profiles[user].lastJoinDay < _latestEndedPublishedDay()) return 0;
        return _profiles[user].joinStreak;
    }

    /// @notice Correct-answer streak, or 0 if the user missed the latest ended published day.
    function currentCorrectStreak(address user) external view returns (uint256) {
        if (_profiles[user].lastCorrectDay < _latestEndedPublishedDay()) return 0;
        return _profiles[user].correctStreak;
    }

    function profile(address user)
        external
        view
        returns (
            uint256 points_,
            uint256 joinStreak_,
            uint256 bestJoinStreak_,
            uint256 lastJoinDay_,
            uint256 correctStreak_,
            uint256 bestCorrectStreak_,
            uint256 bestCorrectAt_,
            uint256 lastCorrectDay_,
            uint256 lastRevealDay_
        )
    {
        UserProfile storage p = _profiles[user];
        return (
            p.points,
            p.joinStreak,
            p.bestJoinStreak,
            p.lastJoinDay,
            p.correctStreak,
            p.bestCorrectStreak,
            p.bestCorrectAt,
            p.lastCorrectDay,
            p.lastRevealDay
        );
    }

    /// @notice Total correct answers (1 correct answer = 1 point).
    function points(address user) external view returns (uint256) {
        return _profiles[user].points;
    }

    function bestCorrectStreak(address user) external view returns (uint256) {
        return _profiles[user].bestCorrectStreak;
    }

    function bestJoinStreak(address user) external view returns (uint256) {
        return _profiles[user].bestJoinStreak;
    }

    function getChallenge(uint256 dayId)
        external
        view
        returns (bytes32 contentHash, bytes32 answerCommit, string memory answer, uint64 answerRevealedAt, bool exists)
    {
        Challenge storage c = challenges[dayId];
        return (c.contentHash, c.answerCommit, c.answer, c.answerRevealedAt, c.exists);
    }

    function getEntry(address user, uint256 dayId)
        external
        view
        returns (bytes32 commitHash, bool revealed, bool correct, bool exists)
    {
        Entry storage e = _entries[user][dayId];
        return (e.commitHash, e.revealed, e.correct, e.exists);
    }

    // --- EIP-712 helpers ---

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256(bytes("SafeStreak")), keccak256(bytes("1")), block.chainid, address(this)
            )
        );
    }

    function _domainSeparator() internal view returns (bytes32) {
        if (block.chainid == _cachedChainId) return _cachedDomainSeparator;
        return _buildDomainSeparator();
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
