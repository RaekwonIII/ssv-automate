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

import { readdirSync, lstatSync } from "fs";

import DepositContract from "../../abi/DepositContract.json";
import SSVContract from "../../abi/DepositContract.json";

const provider = new ethers.JsonRpcProvider(
  `${process.env.RPC_ENDPOINT}`
);

// const signer = provider.getSigner()
const signer = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);


export const automate = new Command("automate");

automate
  .version("0.0.1", "-v, --vers", "output the current version")
  .argument("<owner>", "the address of the cluster owner")
  .requiredOption(
    "-o, --operators <operators>",
    "comma separated list of ids of operators to test",
    commaSeparatedList
  )
  .action(async (owner, options) => {
    console.log(figlet.textSync("SSV Automate"));
    // console.debug(`using GH token ${token}`);
    updateSpinnerText("Fetching developer activity stats for SSV");

    spinnerInfo(`Fetching default Operators Info\n`);

    // 0. load default operators (1, 2, 3) info
    let defaultDKGOperatorsInfo = [];
    for (const operatorId of [1, 2, 3]) {
      let defaultkgOperatorInfo = await getDKGOperatorInfo(operatorId);

      if (!defaultkgOperatorInfo?.dkg_address) {

        spinnerError();
        stopSpinner();
        console.error(`Operator ${operatorId} does not have a DKG endpoint set`);
        return
      }
      defaultDKGOperatorsInfo.push(defaultkgOperatorInfo);
    }

    spinnerInfo(`Obtaining Nonce for user ${owner}\n`);

    // 1. get user's nonce
    const nonce = await getOwnerNonce(owner);

    spinnerInfo(
      `Looping through the provided operator IDs to create new validator keys \n`
    );

    for (const operatorId of options.operators) {
      // 2. invoke dkg-tool

      spinnerInfo(
        `Launching DKG ceremony to create new validator with operators 1, 2, 3, ${operatorId} \n`
      );
      let dkgOperatorInfo = await getDKGOperatorInfo(operatorId);
      if (!dkgOperatorInfo?.dkg_address) {

        spinnerError();
        stopSpinner();
        console.error(`Operator ${operatorId} does not have a DKG endpoint set`);
        continue
      }

      // run DKG ceremony with 3 default operators, and one of the provided operator IDs
      let latestValidator = await runDKG(owner, nonce, [...defaultDKGOperatorsInfo, dkgOperatorInfo]);

      if (!latestValidator) {
        spinnerError()
        stopSpinner();
        continue
      }
      spinnerInfo(`Depositing 32 ETH to activate new validatory key\n`);

      // 3. deposit
      depositValidatorKeys(latestValidator.deposit);

      spinnerInfo(`Registering Validator on SSV network\n`);

      // 4. register
      registerValidatorKeys(latestValidator.keyshare, operatorId)
    }

    spinnerSuccess();

    console.log(`...`);
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
      "https://api.studio.thegraph.com/query/53804/ssv-subgraph/version/latest",
    headers,
    data: requestBody,
  };

  return graphQLOptions;
};

async function getOwnerNonce(owner: string): Promise<number> {
  let nonce = 0;
  try {
    const response = await axios(getGraphQLOptions(owner));
    if (response.status !== 200) throw Error("Request did not return OK");
    if (!response.data.data.account) throw Error("Response is empty");

    let ownerObj = response.data.data.account;

    console.log(`Owner nonce:\n\n${ownerObj.nonce}`);
    nonce = ownerObj.nonce;
  } catch (err) {
    spinnerError();
    stopSpinner();
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

    console.log(`Information for Operator ${operatorID} obtained: ${response.data.dkg_address}`)
    return {
      id: response.data.id,
      public_key: response.data.public_key,
      dkg_address: response.data.dkg_address,
    };
  } catch (err) {
    spinnerError();
    stopSpinner();
    console.error("ERROR DURING AXIOS REQUEST", err);
  }
}

const getDKGOperatorsRequestHeaders = (operator: number) => {
  const headers = {
    "content-type": "application/json",
  };

  const restOptions = {
    method: "GET",
    url: `${process.env.SSV_API}${operator}`,
    headers,
    // data: requestBody,
  };

  return restOptions;
};

/**
 * Execute simple shell command (async wrapper).
 * @param {String} cmd
 * @return {Object} { stdout: String, stderr: String }
 */
async function sh(cmd: string): Promise<{ stdout: String; stderr: String }> {
  return new Promise(function (resolve, reject) {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        for (let line of stderr.split("\n")) {
          console.log(`ls: ${line}`);
        }
        resolve({ stdout, stderr });
      }
    });
  });
}

async function getLatestValidator() {
  const orderReccentFiles = (dir: string) =>
    readdirSync(dir)
      .filter((f) => lstatSync(f).isFile())
      .map((file) => ({ file, mtime: lstatSync(file).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const files = orderReccentFiles(".");
  return files.length ? { keyshare: files[0].file, deposit: files[1].file }: undefined;
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
  let cmd = `docker run -v $(pwd):/data -it "bloxstaking/ssv-dkg:latest" /app init --owner ${owner} --nonce ${nonce} --withdrawAddress ${owner} --operatorIDs ${OP1?.id}. ${OP2?.id}, ${OP3?.id}, ${OP4?.id} --operatorsInfo '[{"id":${OP1?.id},"public_key":"${OP1?.public_key}","ip":"${OP1?.dkg_address}"},{"id":${OP2?.id},"public_key":"${OP2?.public_key}","ip":"${OP2?.dkg_address}"},{"id":${OP3?.id},"public_key":"${OP3?.public_key}","ip":"${OP3?.dkg_address}"},{"id":${OP4?.id},"public_key":"${OP4?.public_key}","ip":"${OP4?.dkg_address}"}"}]' --network holesky --generateInitiatorKey --outputPath /data`;
  console.log(`Running DKG ceremony with command: \n${cmd}\n`)
  let { stdout } = await sh(cmd);
  for (let line of stdout.split("\n")) {
    console.log(`ls: ${line}`);
  }

  return await getLatestValidator();
}

async function depositValidatorKeys(deposit_filename: string) {
  let rawData = fs.readFileSync(deposit_filename, "utf8");
  let deposit_data = JSON.parse(rawData);

  /* next, create the item */
  let contract = new ethers.Contract(
    process.env.DEPOSIT_CONTRACT || "0x4242424242424242424242424242424242424242",
    DepositContract,
    signer
  );

  let deposit = deposit_data.amount;
  let pubkey = deposit_data.pubkey;
  let withdrawal_credentials = deposit_data.withdrawal_credentials;
  let signature = deposit_data.signature;
  let deposit_data_root = deposit_data.deposit_data_root;
  let transaction = await contract.deposit(
    deposit,
    pubkey,
    withdrawal_credentials,
    signature,
    deposit_data_root
  );
  let res = await transaction.wait();
  console.log("Deposited 32 ETH, validator activated: ", res);
}

async function registerValidatorKeys(keyshare_filename: string, operatorID: number) {
  let rawData = fs.readFileSync(keyshare_filename, "utf8");
  let keyshare_data = JSON.parse(rawData);
  /* next, create the item */
  let contract = new ethers.Contract(
    process.env.SSV_CONTRACT || "",
    SSVContract,
    signer
  );
  let deposit = keyshare_data.amount;
  let pubkey = keyshare_data.pubkey;
  let withdrawal_credentials = keyshare_data.withdrawal_credentials;
  let signature = keyshare_data.signature;
  let deposit_data_root = keyshare_data.deposit_data_root;
  let transaction = await contract.registerValidator(
    pubkey,
    [1,2,3,operatorID],
    rawData,
    10,
    [0,0,0,true,0]  // TODO use Graph to check cluster status
  );
  let res = await transaction.wait();
  console.log("Deposited 32 ETH, validator activated: ", res);
}
