// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SafeStreak} from "../src/SafeStreak.sol";
import {MockAgentID} from "../src/MockAgentID.sol";

/// @notice TESTNET ONLY deploy: MockAgentID + SafeStreak.
/// The deployer is owner + publisher + verifier for the trial only.
/// On mainnet, owner must be a Safe 2-of-3 and the three roles must be
/// separate addresses (see BRD key management).
contract DeployTestnet is Script {
    function run() external {
        vm.startBroadcast();

        MockAgentID agentId = new MockAgentID();
        agentId.mint(msg.sender, "safestreak.test");

        // For the trial, deployer holds all three roles.
        SafeStreak streak = new SafeStreak(
            address(agentId),
            msg.sender,
            msg.sender,
            msg.sender
        );

        vm.stopBroadcast();

        console.log("MockAgentID:", address(agentId));
        console.log("SafeStreak:", address(streak));
        console.log("Badge:", address(streak.badge()));
        console.log("SNAPSHOT_BLOCK:", streak.SNAPSHOT_BLOCK());
        console.log("Owner/Publisher/Verifier:", msg.sender);
        console.log("Deployer AgentID balance:", agentId.balanceOf(msg.sender));
        console.log("Deployer handle:", agentId.handleOf(msg.sender));
    }
}
