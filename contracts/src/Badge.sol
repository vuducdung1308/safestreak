// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title SafeStreak Badge
/// @notice Minimal soulbound ERC-721 badge. Only the SafeStreak contract
/// (the minter) can mint. Transfers and approvals always revert, so a badge
/// can never change hands once minted.
contract Badge {
    error Soulbound();
    error NotMinter();
    error NonexistentToken();
    error ZeroAddress();

    string public name = "SafeStreak Badge";
    string public symbol = "SSTREAK";

    address public immutable minter;

    uint256 public nextTokenId = 1;

    struct BadgeInfo {
        uint8 branch; // 0 = join streak, 1 = correct-answer streak
        uint256 milestone; // 3, 7 or 14
    }

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => BadgeInfo) public badgeInfo;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    constructor(address minter_) {
        if (minter_ == address(0)) revert ZeroAddress();
        minter = minter_;
    }

    /// @notice Mint a badge to `to`. Only the SafeStreak contract may call.
    function mint(address to, uint8 branch, uint256 milestone) external onlyMinter returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        tokenId = nextTokenId++;
        _owners[tokenId] = to;
        _balances[to] += 1;
        badgeInfo[tokenId] = BadgeInfo({branch: branch, milestone: milestone});
        emit Transfer(address(0), to, tokenId);
    }

    function balanceOf(address owner_) external view returns (uint256) {
        if (owner_ == address(0)) revert ZeroAddress();
        return _balances[owner_];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner_ = _owners[tokenId];
        if (owner_ == address(0)) revert NonexistentToken();
        return owner_;
    }

    /// @notice No off-chain metadata is hosted for v1; returns an empty URI.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return "";
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    // --- Soulbound: every transfer / approval path reverts. ---

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC165
            || interfaceId == 0x80ac58cd // ERC721
            || interfaceId == 0x5b5e139f; // ERC721Metadata
    }
}
