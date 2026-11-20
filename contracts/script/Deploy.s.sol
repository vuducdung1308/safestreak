// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SafeStreak} from "../src/SafeStreak.sol";

/// @notice Deploy SafeStreak to BNB Chain.
/// Env vars (no private keys in code; the deployer key comes from the CLI):
///   AGENT_ID   Agent ID ERC-721 contract (0x60b9262456de011f7d15a54cdd8c48baaa8b022f on BNB Chain)
///   OWNER      Safe address that owns the contract (onlyOwner role)
///   PUBLISHER  Address that publishes challenges / reveals answers
///   VERIFIER   Address that signs attestation EIP-712 signatures
/// Example:
///   AGENT_ID=0x60b9262456de011f7d15a54cdd8c48baaa8b022f OWNER=<safe> PUBLISHER=<addr> VERIFIER=<addr> \
///     forge script script/Deploy.s.sol --rpc-url $BNB_RPC_URL --broadcast --verify
contract Deploy is Script {
    function run() external {
        address agentId = vm.envAddress("AGENT_ID");
        address owner = vm.envAddress("OWNER");
        address publisher = vm.envAddress("PUBLISHER");
        address verifier = vm.envAddress("VERIFIER");

        vm.startBroadcast();
        SafeStreak streak = new SafeStreak(agentId, owner, publisher, verifier);
        vm.stopBroadcast();

        console.log("SafeStreak:", address(streak));
        console.log("Badge:", address(streak.badge()));
        console.log("SNAPSHOT_BLOCK:", streak.SNAPSHOT_BLOCK());
        console.log("Owner:", streak.owner());
        console.log("Publisher:", streak.publisher());
        console.log("Verifier:", streak.verifier());
    }
}
