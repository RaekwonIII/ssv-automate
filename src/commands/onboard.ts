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

import fs, { readFileSync } from "fs";
import { Web3 } from "web3";

import { readdirSync, lstatSync } from "fs";

import DepositContract from "../../abi/DepositContract.json";
import SSVContract from "../../abi/SSVNetwork.json";
import { glob } from "glob";

export const onboard = new Command("onboard");

type ClusterSnapshot = {
  validatorCount: number;
  networkFeeIndex: number;
  index: number;
  active: boolean;
  balance: number;
};

type ShareObject = {
  data: {
    ownerNonce: number;
    ownerAddress: string;
    publicKey: string;
    operators: [
      {
        id: number;
        operatorKey: string;
      }
    ];
  };
  payload: {
    publicKey: string;
    operatorIds: number[];
    sharesData: string;
  };
};

onboard
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
    if (!owner) throw Error("No owner address provided");

    // 0. load default operators (1, 2, 3) info
    let defaultDKGOperatorsInfo = [];
    for (const operatorId of [1, 2, 3]) {
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

    console.info(`Obtaining Nonce for user ${owner}\n`);
    // 1. get user's nonce
    let nonce = await getOwnerNonceFromSubgraph(owner);

    console.info(`User Nonce: ${nonce}`);

    console.info(
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
      console.info(
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
      // spinnerSuccess();
      console.info(`Depositing 32 ETH to activate new validatory key\n`);
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
      // spinnerSuccess();
      console.info(`Registering Validator on SSV network\n`);
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
      // spinnerSuccess();
      // increment nonce
      nonce += 1;
      console.info(
        `Operator ID ${operatorId} is done. Next user nonce is ${nonce}`
      );
      // spinnerSuccess();
    }

    console.log(`Encountered ${problems.size} problem(s)\n`);

    for (let problem of problems) {
      console.error(`Encountered issue with Operator ${problem[0]}`);
      console.error(problem[1]);
    }

    console.log(`Done. Next user nonce is ${nonce}`);
    // spinnerSuccess();
  });

function commaSeparatedList(value: string, dummyPrevious: any) {
  return value.split(",");
}

async function getOwnerNonceFromSubgraph(owner: string): Promise<number> {
  let nonce = 0;
  try {
    const response = await axios({
      method: "POST",
      url:
        process.env.SUBGRAPH_API ||
        "https://api.studio.thegraph.com/query/71118/ssv-network-holesky/version/latest",
      headers: {
        "content-type": "application/json",
      },
      data: {
        query: `
            query accountNonce($owner: String!) {
                account(id: $owner) {
                    nonce
                }
            }`,
        variables: { owner: owner.toLowerCase() },
      },
    });
    if (response.status !== 200) throw Error("Request did not return OK");
    if (!response.data.data.account) throw Error("Response is empty");

    let ownerObj = response.data.data.account;

    console.debug(`Owner nonce: ${ownerObj.nonce}`);
    nonce = Number(ownerObj.nonce);
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST", err);
  } finally {
    return nonce;
  }
}

async function getClusterSnapshot(
  owner: string,
  operatorIDs: number[]
): Promise<ClusterSnapshot> {
  let clusterSnapshot: ClusterSnapshot = {
    validatorCount: 0,
    networkFeeIndex: 0,
    index: 0,
    active: true,
    balance: 0,
  };
  try {
    const response = await axios({
      method: "POST",
      url:
        process.env.SUBGRAPH_API ||
        "https://api.studio.thegraph.com/query/71118/ssv-network-holesky/version/latest",
      headers: {
        "content-type": "application/json",
      },
      data: {
        query: `
            query clusterSnapshot($cluster: String!) {
              cluster(id: $cluster) {
                validatorCount
                networkFeeIndex
                index
                active
                balance
              }
            }`,
        variables: {
          cluster: `${owner.toLowerCase()}-${operatorIDs.join("-")}`,
        },
      },
    });
    if (response.status !== 200) throw Error("Request did not return OK");

    if (response.data.data.cluster)
      clusterSnapshot = response.data.data.cluster

    console.debug(`Cluster snapshot: { validatorCount: ${clusterSnapshot.validatorCount}, networkFeeIndex: ${clusterSnapshot.networkFeeIndex}, index: ${clusterSnapshot.index}, active: ${clusterSnapshot.active}, balance: ${clusterSnapshot.balance},}`
  )
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST", err);
  } finally {
    return clusterSnapshot;
  }
}

async function getDKGOperatorInfo(
  operatorID: number
): Promise<
  { id: number; public_key: string; dkg_address: string } | undefined
> {
  try {
    const response = await axios({
      method: "GET",
      url: `${process.env.SSV_API}/operators/${operatorID}`,
      headers: {
        "content-type": "application/json",
      },
    });

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

/**
 * Execute simple shell command (async wrapper).
 * @param {String} cmd
 * @return {Object} { stdout: String, stderr: String }
 */
async function sh(cmd: string): Promise<{ stdout: String; stderr: String }> {
  return new Promise(function (resolve, reject) {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`The following command failed:\n${err.cmd}\nError log:\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function getLatestValidator() {
  const getMostRecentFile = async (dir: string, prefix: string) => {
    let filesList = await glob(`${dir}/**/${prefix}**.json`, {
      nodir: true,
    })

    filesList
    .map((f) => ({
      file: `${f}`,
      mtime: lstatSync(`${f}`).mtime,
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .map((x) => x.file)
    return filesList.at(0)
  }

  let dir = `${__dirname}/../../${process.env.OUTPUT_FOLDER}`;

  const deposit = await getMostRecentFile(dir, "deposit_data");
  console.debug(
    `Deposit file: ${deposit}`
  );
  const keyshare = await getMostRecentFile(dir, "keyshares");
  console.debug(
    `Keyshares file: ${keyshare}`
  );

  if (deposit && keyshare)
    return { keyshare, deposit };

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
  let cmd = `docker run -v $(pwd)/${process.env.OUTPUT_FOLDER}:/data "bloxstaking/ssv-dkg:v2.1.0" init --owner ${owner} --nonce ${nonce} --withdrawAddress ${owner} --operatorIDs ${OP1?.id},${OP2?.id},${OP3?.id},${OP4?.id} --operatorsInfo '[{"id":${OP1?.id},"public_key":"${OP1?.public_key}","ip":"${OP1?.dkg_address}"},{"id":${OP2?.id},"public_key":"${OP2?.public_key}","ip":"${OP2?.dkg_address}"},{"id":${OP3?.id},"public_key":"${OP3?.public_key}","ip":"${OP3?.dkg_address}"},{"id":${OP4?.id},"public_key":"${OP4?.public_key}","ip":"${OP4?.dkg_address}"}]' --network holesky --validators 5 --logFilePath /data/debug.log --outputPath /data`;
  // console.debug(`Running DKG ceremony with command: \n${cmd}\n`);
  let { stdout, stderr } = await sh(cmd);
  for (let line of stderr.split("\n")) {
    console.error(`${line}`);
  }
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

async function registerValidatorKeys(
  keyshare_filename: string,
  owner: string,
  operatorID: number
) {
  let sharesDataObjectArray : ShareObject[] = JSON.parse(readFileSync(keyshare_filename, "utf-8")).shares;

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

  let pubkeys = sharesDataObjectArray.map((singleKeyShare) => {
    return singleKeyShare.payload.publicKey;
  });

  let sharesData = sharesDataObjectArray.map((singleKeyShare) => {
    return singleKeyShare.payload.sharesData;
  });

  let operatorIds = sharesDataObjectArray[0].payload.operatorIds
  let amount = ethers.utils.parseEther("10");
  const clusterSnapshot = await getClusterSnapshot(owner, operatorIds);

  // This needs approval for spending SSV token
  // https://holesky.etherscan.io/address/0xad45A78180961079BFaeEe349704F411dfF947C6#writeContract
  let transaction = await contract.bulkRegisterValidator(
    pubkeys,
    operatorIds,
    sharesData,
    amount,
    clusterSnapshot,
    {
      gasLimit: 3000000, // gas estimation does not work
    }
  );
  let res = await transaction.wait();
  console.debug(`Registered validators`, pubkeys);
  console.debug(`Transaction Hash:`, res.transactionHash);
}
