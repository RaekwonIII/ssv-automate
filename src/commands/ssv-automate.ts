import { Command } from "commander";
import {
  spinnerError,
  spinnerInfo,
  spinnerSuccess,
  stopSpinner,
  updateSpinnerText,
} from "../spinner";
import figlet from "figlet";
import axios from "axios";
import { exec } from "child_process";
import { ethers } from "ethers";

import fs from "fs";
import { Web3 } from "web3";

import { readdirSync, lstatSync } from "fs";

import DepositContract from "../../abi/DepositContract.json";
import SSVContract from "../../abi/SSVNetwork.json";
// import { ClusterScanner, NonceScanner } from "ssv-scanner";

export const automate = new Command("automate");

automate
  .version("0.0.1", "-v, --vers", "output the current version")
  .argument("<owner>", "the address of the cluster owner")
  .option(
    "-o, --operators <operators>",
    "comma separated list of ids of operators to test",
    commaSeparatedList
  )
  .action(async (owner, options) => {
    console.info(figlet.textSync("SSV Automate"));
    console.log(
      "Automating validator key creation, activation and registration\n"
    );

    // 0. load default operators (1, 2, 3) info
    let defaultDKGOperatorsInfo = [];
    for (const operatorId of [1, 3, 4]) {
      let defaultkgOperatorInfo = await getDKGOperatorInfo(operatorId);

      if (!defaultkgOperatorInfo?.dkg_address) {
        spinnerError();
        stopSpinner();
        console.error(
          `Operator ${operatorId} does not have a DKG endpoint set`
        );
        return;
      }
      defaultDKGOperatorsInfo.push(defaultkgOperatorInfo);
    }

    console.log(
      `Fetched default Operators Info: ${defaultDKGOperatorsInfo
        .map((item: { dkg_address: any }) => {
          return `${item.dkg_address}`;
        })
        .join(", ")}\n`
    );

    // we could either get a list of operator IDs to create clusters with,
    // or find Lido operators that have not been tested yet, depending on the script argument
    let operators = options.operators.map((item: string) => parseInt(item));

    updateSpinnerText(`Obtaining Nonce for user ${owner}\n`);
    // 1. get user's nonce
    let nonce = 230; // await getOwnerNonce(owner);

    updateSpinnerText(`User Nonce: ${nonce}`);

    updateSpinnerText(
      `Looping through the provided operator IDs to create new validator keys \n`
    );

    let problems = new Map();
    for (const operatorId of operators) {
      // attempt to fetch it from the map
      let dkgOperatorInfo = await getDKGOperatorInfo(operatorId);

      if (!dkgOperatorInfo?.dkg_address) {
        spinnerError();
        stopSpinner();
        console.error(
          `Operator ${operatorId} does not have a DKG endpoint set`
        );
        problems.set(
          operatorId,
          `Operator ${operatorId} does not have a DKG endpoint set`
        );
        continue;
      }
      // 2. invoke dkg-tool
      updateSpinnerText(
        `Launching DKG ceremony to create new validator with operators 1, 2, 3, ${operatorId} \n`
      );
      // run DKG ceremony with 3 default operators, and one of the provided operator IDs\
      let latestValidator;
      try {
        latestValidator = await runDKG(owner, nonce, [
          ...defaultDKGOperatorsInfo,
          dkgOperatorInfo,
        ]);
      } catch (error) {
        spinnerError();
        stopSpinner();
        console.error(`DKG Ceremony failed for Operator ${operatorId}:`)
        problems.set(
          operatorId,
          `DKG Ceremony failed for Operator ${operatorId}:\n${error}`
        );
        continue;
      }
      if (!latestValidator) {
        spinnerError();
        stopSpinner();
        console.error(`DKG Ceremony for Operator ${operatorId} did not generate a new validator`)
        problems.set(
          operatorId,
          `DKG Ceremony for Operator ${operatorId} did not generate a new validator`
        );
        continue;
      }
      spinnerSuccess();
      updateSpinnerText(`Depositing 32 ETH to activate new validatory key\n`);
      // 3. deposit
      try {
        await depositValidatorKeys(latestValidator.deposit);
      } catch (error) {
        console.error(error);
        spinnerError();
        stopSpinner();
        console.error(`Could not activate Operator ${operatorId}`)
        problems.set(
          operatorId,
          `Could not activate Operator ${operatorId}:\n${error}`
        );
        continue;
      }
      spinnerSuccess();
      updateSpinnerText(`Registering Validator on SSV network\n`);
      // 4. register
      try {
        await registerValidatorKeys(
          latestValidator.keyshare,
          owner,
          operatorId
        );
      } catch (error) {
        spinnerError();
        stopSpinner();
        console.error(`Could not register Operator ${operatorId}`)
        problems.set(
          operatorId,
          `Could not register Operator ${operatorId}:\n${error}`
        );
        continue;
      }
      spinnerSuccess();
      // increment nonce
      nonce += 1;
      updateSpinnerText(
        `Operator ID ${operatorId} is done. Next user nonce is ${nonce}`
      );
      spinnerSuccess();
    }

    console.log(`Encountered ${problems.size} problem(s)\n`);

    for (let problem of problems) {
      console.error(`Encountered issue with Operator ${problem[0]}`);
      console.error(problem[1]);
    }

    console.log(`Done. Next user nonce is ${nonce}`);
    spinnerSuccess();
  });

function commaSeparatedList(value: string, dummyPrevious: any) {
  return value.split(",");
}

const getGraphQLOptions = (owner: string) => {
  const headers = {
    "content-type": "application/json",
  };

  const requestBody = {
    query: `
        query accountNonce($owner: String!) {
            account(id: $owner) {
                nonce
            }
        }`,
    variables: { owner: owner.toLowerCase() },
  };

  const graphQLOptions = {
    method: "POST",
    url:
      process.env.SUBGRAPH_API ||
      "https://api.thegraph.com/subgraphs/name/raekwoniii/ssv-subgraph",
    headers,
    data: requestBody,
  };

  return graphQLOptions;
};

// https://github.com/oven-sh/bun/issues/3546
// async function getOwnerNonce(owner: string): Promise<number> {
//   const params = {
//     network: `${process.env.NETWORK}`,
//     nodeUrl: `${process.env.RPC_ENDPOINT}`,
//     ownerAddress: `${owner}`,
//     operatorIds: [],
//   };
//   const nonceScanner = new NonceScanner(params);
//   const nextNonce = await nonceScanner.run();
//   return nextNonce;
// }

async function getOwnerNonceFromSubgraph(owner: string): Promise<number> {
  let nonce = 0;
  try {
    const response = await axios(getGraphQLOptions(owner));
    if (response.status !== 200) throw Error("Request did not return OK");
    if (!response.data.data.account) throw Error("Response is empty");

    let ownerObj = response.data.data.account;

    console.debug(`Owner nonce:\n\n${ownerObj.nonce}`);
    nonce = ownerObj.nonce;
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST", err);
  } finally {
    return nonce;
  }
}

async function getDKGOperatorInfo(
  operatorID: number
): Promise<
  { id: number; public_key: string; dkg_address: string } | undefined
> {
  try {
    const response = await axios(getDKGOperatorsRequestHeaders(operatorID));

    if (response.status !== 200) throw Error("Request did not return OK");

    return {
      id: response.data.id,
      public_key: response.data.public_key,
      dkg_address: response.data.dkg_address,
    };
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST");
  }
}

const getDKGOperatorsRequestHeaders = (operator: number) => {
  const headers = {
    "content-type": "application/json",
  };

  const restOptions = {
    method: "GET",
    url: `${process.env.SSV_API}/operators/${operator}`,
    headers,
  };

  return restOptions;
};

async function getClustersOwnedBy(
  owner: string
): Promise<{ id: number; operators: number[] }[] | undefined> {
  // fetch all clusters owned by provided address
  // https://api.ssv.network/api/v4/holesky/clusters/owner/0xaA184b86B4cdb747F4A3BF6e6FCd5e27c1d92c5c?page=1&perPage=10&ordering=id%3Aasc
  try {
    const response = await axios({
      method: "GET",
      url: `${process.env.SSV_API}/clusters/owner/${owner}?page=1&perPage=100&ordering=id%3Aasc`,
      headers: {
        "content-type": "application/json",
      },
    });

    if (response.status !== 200) throw Error("Request did not return OK");

    // return an array of objects {cluster_id, list_of_operator_ids_in_cluster}
    return response.data.clusters.map(
      (cluster: { id: any; operators: number[] }) => {
        return {
          id: cluster.id,
          operators: cluster.operators,
        };
      }
    );
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST");
  }
}

async function getLidoperatorsInfo(): Promise<
  | Map<number, { id: number; public_key: string; dkg_address: string }>
  | undefined
> {
  try {
    // Fetch all operators that have "Lido -" in their name
    // https://api.ssv.network/api/v4/holesky/operators?page=1&perPage=5000&ordering=id%3Aasc&search=Lido%20-

    const response = await axios({
      method: "GET",
      url: `${process.env.SSV_API}/operators?page=1&perPage=500&ordering=id%3Aasc&search=Lido%20-`,
      headers: {
        "content-type": "application/json",
      },
    });

    if (response.status !== 200) throw Error("Request did not return OK");

    // generate a map with {id: {operator info}}
    return new Map(
      response.data.operators.map(
        (operator: { id: any; public_key: any; dkg_address: any }) => [
          operator.id,
          {
            id: operator.id,
            public_key: operator.public_key,
            dkg_address: operator.dkg_address,
          },
        ]
      )
    );
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST");
  }
}

function getNewLidoOperators(
  lidoOperators:
    | Map<number, { id: number; public_key: string; dkg_address: string }>
    | undefined,
  clustersOwned: any[] | undefined
): Map<
  number,
  {
    id: number;
    public_key: string;
    dkg_address: string;
  }
> {
  // generate empty map if there is no overlap (all Lido operators appear in a cluster of this user)
  let newOperators = new Map();

  if (lidoOperators && clustersOwned) {
    // flatten the array of arrays of operator IDs in various clusters and remove duplicates (Set)
    let operatorIDsInOwnedClusters: Set<number> = new Set(
      clustersOwned
        .map((item) => item.operators)
        .reduce(
          (accumulator: number[], value: number[]) => accumulator.concat(value),
          []
        )
    );
    // create a new map, by filtering lido operators: if the operator ID appears in any cluster, discard it
    newOperators = new Map(
      Array.from(lidoOperators).filter(([_key, value]) => {
        if ([...operatorIDsInOwnedClusters].includes(_key)) {
          return false;
        }

        return true;
      })
    );
  }

  return newOperators;
}

/**
 * Execute simple shell command (async wrapper).
 * @param {String} cmd
 * @return {Object} { stdout: String, stderr: String }
 */
async function sh(cmd: string): Promise<{ stdout: String; stderr: String }> {
  return new Promise(function (resolve, reject) {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`The following command failed:\n${err.cmd}\nError log:\n${stdout}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function getLatestValidator() {
  const orderRecentFilesByName = (dir: string, prefix: string) =>
    readdirSync(dir)
      .filter((f) => lstatSync(`${dir}/${f}`).isFile())
      .filter((f) => f.startsWith(prefix))
      .map((f) => ({
        file: `${dir}/${f}`,
        mtime: lstatSync(`${dir}/${f}`).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      .map((x) => x.file);

  let dir = `${__dirname}/../../${process.env.OUTPUT_FOLDER}`;

  const deposit = orderRecentFilesByName(dir, "deposit");
  console.debug(
    `Deposit file: ${deposit?.[0].substring(dir.length, deposit.length)}`
  );

  const keyshares = orderRecentFilesByName(dir, "keyshare");
  console.debug(
    `Keyshares file: ${keyshares?.[0].substring(dir.length, keyshares.length)}`
  );

  if (deposit.length && keyshares.length)
    return { keyshare: keyshares[0], deposit: deposit[0] };

  return undefined;
}

async function runDKG(
  owner: string,
  nonce: number,
  dkgOperatorsInfo: (
    | { id: number; public_key: string; dkg_address: string }
    | undefined
  )[]
) {
  let [OP1, OP2, OP3, OP4] = dkgOperatorsInfo;
  let cmd = `docker run -v $(pwd)/${process.env.OUTPUT_FOLDER}:/data "bloxstaking/ssv-dkg:latest" /app init --owner ${owner} --nonce ${nonce} --withdrawAddress ${owner} --operatorIDs ${OP1?.id},${OP2?.id},${OP3?.id},${OP4?.id} --operatorsInfo '[{"id":${OP1?.id},"public_key":"${OP1?.public_key}","ip":"${OP1?.dkg_address}"},{"id":${OP2?.id},"public_key":"${OP2?.public_key}","ip":"${OP2?.dkg_address}"},{"id":${OP3?.id},"public_key":"${OP3?.public_key}","ip":"${OP3?.dkg_address}"},{"id":${OP4?.id},"public_key":"${OP4?.public_key}","ip":"${OP4?.dkg_address}"}]' --network holesky --generateInitiatorKey --outputPath /data`;
  // console.debug(`Running DKG ceremony with command: \n${cmd}\n`);
  let { stdout } = await sh(cmd);
  for (let line of stdout.split("\n")) {
    console.info(`${line}`);
  }

  return await getLatestValidator();
}

async function depositValidatorKeys(deposit_filename: string) {
  let rawData = fs.readFileSync(deposit_filename, "utf8");
  let deposit_data = JSON.parse(rawData)[0];
  // console.debug("Parsed data:")
  // console.debug(deposit_data);

  const provider = new ethers.providers.JsonRpcProvider(
    `${process.env.RPC_ENDPOINT}`
  );

  const signer = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

  /* next, create the item */
  let contract = new ethers.Contract(
    process.env.DEPOSIT_CONTRACT ||
      "0x4242424242424242424242424242424242424242",
    DepositContract,
    signer
  );

  let deposit = ethers.utils.parseEther("32"); // deposit_data.amount;
  let pubkey = Web3.utils.hexToBytes(deposit_data.pubkey);
  let withdrawal_credentials = Web3.utils.hexToBytes(
    deposit_data.withdrawal_credentials
  );
  let signature = Web3.utils.hexToBytes(deposit_data.signature);
  let deposit_data_root = Web3.utils.hexToBytes(deposit_data.deposit_data_root);

  console.debug(
    `Activating validator ${Web3.utils.bytesToHex(pubkey)}\nOn network: ${
      deposit_data.network_name
    }`
  );

  // const gasLimit = contract.estimateGas.deposit(
  //   pubkey,
  //   withdrawal_credentials,
  //   signature,
  //   deposit_data_root
  // );

  let transaction = await contract.deposit(
    pubkey,
    withdrawal_credentials,
    signature,
    deposit_data_root,
    {
      value: deposit,
      gasLimit: 3000000,
    }
  );
  let res = await transaction.wait();
  console.debug("Deposited 32 ETH, validator activated: ", res.transactionHash);
}

// https://github.com/oven-sh/bun/issues/3546
// async function getClusterSnapshot(
//   owner: string,
//   operatorIds: number[]
// ): Promise<any[]> {
//   const params = {
//     network: `${process.env.NETWORK}`,
//     nodeUrl: `${process.env.RPC_ENDPOINT}`,
//     ownerAddress: `${owner}`,
//     operatorIds: operatorIds,
//   };

//   const clusterScanner = new ClusterScanner(params);
//   const result = await clusterScanner.run(params.operatorIds);
//   console.info(`Obtained cluster snapshot: ${result.cluster}`);
//   return Object.values(result.cluster);
// }

async function registerValidatorKeys(
  keyshare_filename: string,
  owner: string,
  operatorID: number
) {
  let rawData = fs.readFileSync(keyshare_filename, "utf8");
  let keyshare_data = JSON.parse(rawData);

  const provider = new ethers.providers.JsonRpcProvider(
    `${process.env.RPC_ENDPOINT}`
  );

  const signer = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

  /* next, create the item */
  let contract = new ethers.Contract(
    process.env.SSV_CONTRACT || "",
    SSVContract,
    signer
  );

  let pubkey = keyshare_data.payload.publicKey;
  let operatorIds = keyshare_data.payload.operatorIds;
  let sharesData = keyshare_data.payload.sharesData;
  let amount = ethers.utils.parseEther("10");
  const clusterSnapshot =
    // await getClusterSnapshot(owner, operatorIds)
    {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      active: true,
      balance: 0,
    };

  // const gasLimit = contract.estimateGas.registerValidator(
  //   pubkey,
  //   operatorIds,
  //   sharesData,
  //   amount,
  //   clusterSnapshot
  // );

  // This needs approval for spending SSV token
  // https://holesky.etherscan.io/address/0xad45A78180961079BFaeEe349704F411dfF947C6#writeContract
  let transaction = await contract.registerValidator(
    pubkey,
    operatorIds,
    sharesData,
    amount,
    clusterSnapshot,
    {
      gasLimit: 3000000, // gas estimation does not work
    }
  );
  let res = await transaction.wait();
  console.debug(`Registered validator ${pubkey}: `, res.transactionHash);
}
