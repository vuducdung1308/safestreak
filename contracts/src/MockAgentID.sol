// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice TESTNET ONLY mock of the Agent ID contract.
/// Mainnet Agent ID (0x60b9262456de011f7d15a54cdd8c48baaa8b022f) does not
/// exist on BSC testnet, so this mock is used for testnet trials only.
/// Do NOT deploy this on mainnet. Only the owner can mint / set handles.
contract MockAgentID {
    address public owner;
    mapping(address => uint256) public balances;
    mapping(address => string) public handles;

    event Minted(address indexed user, string handle);

    constructor() {
        owner = msg.sender;
    }

    function mint(address user, string calldata handle) external {
        require(msg.sender == owner, "not owner");
        require(balances[user] == 0, "already has id");
        balances[user] = 1;
        handles[user] = handle;
        emit Minted(user, handle);
    }

    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }

    function handleOf(address user) external view returns (string memory) {
        return handles[user];
    }
}
