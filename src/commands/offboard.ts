import { Command } from "commander";
import {
  spinnerError,
  spinnerSuccess,
  stopSpinner,
} from "../spinner";
import figlet from "figlet";
import axios from "axios";
import { ethers } from "ethers";

import SSVContract from "../../abi/SSVNetwork.json";

export const offboard = new Command("offboard");

type ClusterSnapshot = {
  validatorCount: number;
  networkFeeIndex: number;
  index: number;
  active: boolean;
  balance: number;
};

type ClusterObj = {
  id: string;
  validatorCount: number;
  networkFeeIndex: number;
  index: number;
  active: boolean;
  balance: number;
  operatorIds: string[];
  validators: {
    id: string;
    active: boolean;
  }[];
};

offboard
  .version("0.0.1", "-v, --vers", "output the current version")
  .argument("<owner>", "the address of the cluster owner")
  .argument("<action>", "the action to perform on the cluster (exit|remove|liquidate)")

  .action(async (owner, action) => {
    console.info(figlet.textSync("SSV Automate Offboarding"));
    console.log("Automating cluster offboarding\n");
    console.log(`Performing ${action} action`)

    // 1. get user's nonce
    let clustersOwned = await getClustersDataFromSubgraph(owner);
    let problems = new Map();
    for (let cluster of clustersOwned) {
      
      console.log(`Processing cluster ${cluster.id}`)

      if (cluster.validatorCount > 1) {
        console.error(`Cluster ${cluster.id} has ${cluster.validatorCount} validators, they can't be exited one by one`)
        problems.set(
          cluster.id,
          `Cluster ${cluster.id} has ${cluster.validatorCount} validators, they can't be exited one by one`
        );
        continue;
      }

      if (!cluster.active && action === "liquidate") {
        
        try {
          const clusterSnapshot = {
            validatorCount: cluster.validatorCount,
            networkFeeIndex: cluster.networkFeeIndex,
            index: cluster.index,
            active: cluster.active,
            balance: cluster.balance,
          };
          console.log(`Liquidating cluster ${cluster.id}`)
          await liquidateCluster(owner, cluster.operatorIds, clusterSnapshot);
        } catch (error) {
          console.error(error);
          spinnerError();
          stopSpinner();
          console.error(`Error liquidating cluster cluster ${cluster.id}`);
          problems.set(
            cluster.id,
            `Error liquidating cluster cluster ${cluster.id}:\n${error}`
          );
          continue;
        }
      }
      
      for (let validator of cluster.validators){
        console.log(`Processing validator ${validator.id}, cluster ${cluster.id}`)

        if (action === "exit") {
          try {
            console.log(`Exiting validator ${validator.id} of cluster ${cluster.id}`)
            await exitValidator(validator.id, cluster.operatorIds);
          } catch (error) {
            console.error(error);
            spinnerError();
            stopSpinner();
            console.error(`Error exiting validator ${validator.id} of cluster ${cluster.id}`);
            problems.set(
              validator.id,
              `Error exiting validator ${validator.id} of cluster ${cluster.id}:\n${error}`
            );
            continue;
          }
        } else if (action === "remove") {
          try {
            const clusterSnapshot = {
              validatorCount: cluster.validatorCount,
              networkFeeIndex: cluster.networkFeeIndex,
              index: cluster.index,
              active: cluster.active,
              balance: cluster.balance,
            };
            console.log(`Removing validator ${validator.id} of cluster ${cluster.id}`)
            await removeValidator(validator.id, cluster.operatorIds, clusterSnapshot);
          } catch (error) {
            console.error(error);
            spinnerError();
            stopSpinner();
            console.error(`Error removing validator ${validator.id} of cluster ${cluster.id}`);
            problems.set(
              validator.id,
              `Error removing validator ${validator.id} of cluster ${cluster.id}:\n${error}`
            );
            continue;
          }
        }
      }
    }

    console.log(`Encountered ${problems.size} problem(s)\n`);

    for (let problem of problems) {
      console.error(`Encountered issue with Cluster/Validator ${problem[0]}`);
      console.error(problem[1]);
    }

    spinnerSuccess();
  });

const getGraphQLOptions = (owner: string) => {
  const headers = {
    "content-type": "application/json",
  };

  const requestBody = {
    query: `
        query accountClusters($owner: String!) {
            account(id: $owner) {
              clusters {
                id
                validatorCount
                networkFeeIndex
                index
                active
                balance
                operatorIds
                validators {
                  id
                  active
                }
              }
            }
        }`,
    variables: { owner: owner.toLowerCase() },
  };

  const graphQLOptions = {
    method: "POST",
    url:
      process.env.SUBGRAPH_API ||
      "https://api.studio.thegraph.com/query/53804/ssv-holesky/version/latest",
    headers,
    data: requestBody,
  };

  return graphQLOptions;
};

async function getClustersDataFromSubgraph(owner: string): Promise<ClusterObj[]> {
  let clustersObjList = [];
  try {
    const response = await axios(getGraphQLOptions(owner));
    if (response.status !== 200) throw Error("Request did not return OK");
    if (!response.data.data.account) throw Error("Response is empty");

     clustersObjList = response.data.data.account.clusters;

    console.debug(`Found ${clustersObjList.length} clusters`);
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST", err);
  } finally {
    return clustersObjList;
  }
}

async function exitValidator(pubkey:string, operatorIds: string[]) {
  const provider = new ethers.providers.JsonRpcProvider(
    `${process.env.RPC_ENDPOINT}`
  );

  const signer = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

  let contract = new ethers.Contract(
    process.env.SSV_CONTRACT || "",
    SSVContract,
    signer
  );

  let operatorNumeralIds = operatorIds.map((idString) => Number.parseInt(idString))
  let transaction = await contract.exitValidator(
    pubkey,
    operatorNumeralIds,
  );
  let res = await transaction.wait();
  console.debug(`Exited validator ${pubkey}: `, res.transactionHash);
}

async function removeValidator(pubkey:string, operatorIds: string[], clusterSnapshot: ClusterSnapshot) {
  const provider = new ethers.providers.JsonRpcProvider(
    `${process.env.RPC_ENDPOINT}`
  );

  const signer = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

  let contract = new ethers.Contract(
    process.env.SSV_CONTRACT || "",
    SSVContract,
    signer
  );

  let operatorNumeralIds = operatorIds.map((idString) => Number.parseInt(idString))
    
  let transaction = await contract.removeValidator(
    pubkey,
    operatorNumeralIds,
    clusterSnapshot,
    {
      gasLimit: 3000000, // gas estimation does not work
    }
  );
  let res = await transaction.wait();
  console.debug(`Removed validator ${pubkey}: `, res.transactionHash);
}

async function liquidateCluster(owner:string, operatorIds: string[], clusterSnapshot: ClusterSnapshot) {
  const provider = new ethers.providers.JsonRpcProvider(
    `${process.env.RPC_ENDPOINT}`
  );

  const signer = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

  let contract = new ethers.Contract(
    process.env.SSV_CONTRACT || "",
    SSVContract,
    signer
  );

  let operatorNumeralIds = operatorIds.map((idString) => Number.parseInt(idString))
    
  let transaction = await contract.liquidate(
    owner,
    operatorNumeralIds,
    clusterSnapshot,
    {
      gasLimit: 3000000, // gas estimation does not work
    }
  );
  let res = await transaction.wait();
  console.debug(`Liquidated cluster ${owner}-${operatorIds.join("-")}: `, res.transactionHash);
}
