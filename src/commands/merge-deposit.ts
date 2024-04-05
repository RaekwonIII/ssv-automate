import { Command } from "commander";
import figlet from "figlet";
import axios from "axios";
import axiosRateLimit from "axios-rate-limit";
import { writeFile, readFileSync } from "node:fs";
import { glob } from "glob";

export const mergeDeposit = new Command("merge-deposit");

function commaSeparatedList(value: string, dummyPrevious: any) {
  return value.split(",");
}

mergeDeposit
  .version("0.0.1", "-v, --vers", "output the current version")
  .argument(
    "<folder>",
    "the absolute path to the DKG operator output folder (e.g. /home/user/ssv-dkg/output)"
  )
  .option(
    "-t, --txhashes <txhashes>",
    "a comma-separated list of transaction hashes from which to extract validator public keys",
    commaSeparatedList
  )
  .option(
    "-o, --output <output>",
    "a comma-separated list of transaction hashes from which to extract validator public keys"
  )
  .action(async (folder, options) => {
    console.info(figlet.textSync("Simple DVT Merge Deposit files"));

    let pubKeyList = await getPubKeysFromTxHashes(options.txhashes);
    console.debug(
      `Found ${pubKeyList.length} public keys from ${
        options.txhashes.length || 1
      } transactions`
    );
    console.debug(pubKeyList);

    console.log("Verifying validity of registered keyshares");
    try {
      verifyKeyshares(pubKeyList);
    } catch (e) {
      console.error(e);
      return;
    }

    console.log(`Searching for keyshares files in folder:\n${folder}`);
    let keysharesFilesObjectsLits = await getKeyshares(folder, pubKeyList);

    let noncePubKeyMap: Map<string, number> = new Map(
      keysharesFilesObjectsLits.map((obj) => [
        obj.shares[0].data.publicKey.slice(2),
        obj.shares[0].data.ownerNonce,
      ])
    );

    console.log(`Searching for deposit files in folder:\n${folder}`);
    try {
      let depositFilesObjectsLits = await getDeposit(folder, pubKeyList);

      // sort with custom sort function based on user nonce of certain public key
      depositFilesObjectsLits.sort(
        (a: { pubkey: string }, b: { pubkey: string }) => {
          let nonceA = noncePubKeyMap.get(a.pubkey) || 0;
          let nonceB = noncePubKeyMap.get(b.pubkey) || 0;
          return nonceA - nonceB;
        }
      );

      mergeDepositFiles(options.output, depositFilesObjectsLits);
      console.debug("Done.");
    } catch (e) {
      console.error(e);
      return;
    }
  });

async function verifyKeyshares(pubKeyList: string[]): Promise<void> {
  let validKeyshares = 0;
  const http = axiosRateLimit(axios.create(), { maxRPS: 10 });
  for (let pubKey of pubKeyList) {
    try {
      const response = await http.get(
        `${process.env.SSV_API}/validators/${pubKey}`,
        {
          headers: {
            "content-type": "application/json",
          },
        }
      );

      if (response.status !== 200) throw Error("Request did not return OK");

      // add 1 more value to the number of value keyshares
      if (
        response.data.is_valid &&
        response.data.is_public_key_valid &&
        response.data.is_shares_valid &&
        response.data.is_operators_valid
      ) {
        validKeyshares += 1;
      } else {
        console.error(
          `Public key ${pubKey} has been incorrectly register and has invalid keyshares`
        );
      }
    } catch (err) {
      console.error("ERROR DURING AXIOS REQUEST");
    }
  }
  if (validKeyshares < pubKeyList.length)
    throw Error("Some keyshares are invalid");
}

function mergeDepositFiles(output: string, depositFilesObjectsLits: any[]) {
  var date = new Date();
  var month = date.getMonth() + 1; // "+ 1" because the 1st month is 0
  var day = date.getDate();
  var hours = date.getHours();
  var minutes = date.getMinutes();
  var seconds = date.getSeconds();
  const filename = `${output}/deposit_data-${date.getFullYear()}-${
    (month < 10 ? "0" : "") + month
  }-${(day < 10 ? "0" : "") + day}T${(hours < 10 ? "0" : "") + hours}-${
    (minutes < 10 ? "0" : "") + minutes
  }-${(seconds < 10 ? "0" : "") + seconds}Z.json`;

  console.debug(`Writing deposit file data to file: ${filename}`);
  // console.log(depositFilesObjectsLits)
  writeFile(filename, JSON.stringify(depositFilesObjectsLits), (err) => {
    if (err) {
      console.error(err);
    } else {
      console.log("Wrote deposit file data");
    }
  });
}

async function getDeposit(folder: string, pubKeyList: string[]) {
  let depositFilesPathList = await glob(`${folder}/**/deposit_data.json`, {
    nodir: true,
    ignore: {
      ignored: (p) => {
        const pp = p.parent;
        return !pubKeyList.includes(pp?.name.split("-")[1] || "");
      },
    },
  });
  console.debug(
    `Found ${depositFilesPathList.length} deposit files for the ${pubKeyList.length} public keys`
  );

  if (depositFilesPathList.length != pubKeyList.length) {
    console.error(
      "Found a different number of keyshares files than deposit files, exiting"
    );
    throw Error(
      "Found a different number of keyshares files than deposit files, exiting"
    );
  }

  console.log(depositFilesPathList);
  let depositFilesObjectsLits = depositFilesPathList.map((depositFilesPath) => {
    return JSON.parse(readFileSync(depositFilesPath, "utf-8"))[0];
  });
  return depositFilesObjectsLits;
}

async function getKeyshares(folder: string, pubKeyList: string[]) {
  let keyshareFilesPathList = await glob(`${folder}/**/keyshares.json`, {
    nodir: true,
    ignore: {
      ignored: (p) => {
        const pp = p.parent;
        return !pubKeyList.includes(pp?.name.split("-")[1] || "");
      },
    },
  });
  console.debug(
    `Found ${keyshareFilesPathList.length} keyshares files for the ${pubKeyList.length} public keys`
  );
  let keysharesFilesObjectsLits = keyshareFilesPathList.map(
    (keyshareFilesPath) => {
      return JSON.parse(readFileSync(keyshareFilesPath, "utf-8"));
    }
  );
  return keysharesFilesObjectsLits;
}

async function getPubKeysFromTxHashes(txhashes: string[]): Promise<string[]> {
  const http = axiosRateLimit(axios.create(), { maxRPS: 1 });
  const url =
    process.env.SUBGRAPH_API ||
    "https://api.studio.thegraph.com/query/53804/ssv-holesky/v0.0.1";

  let pubKeyList: string[] = [];
  try {
    const response = await http.post(url, getGraphQLQuery(txhashes), {
      headers: {
        "content-type": "application/json",
      },
    });
    if (response.status !== 200) throw Error("Request did not return OK");
    if (!response.data.data.validatorAddeds) throw Error("Response is empty");
    let pubkeyObjList = response.data.data.validatorAddeds;

    console.debug(`Found ${pubkeyObjList.length} pubkeys`);
    pubKeyList = pubkeyObjList.map((pubKeyObj: { publicKey: string }) => {
      return pubKeyObj.publicKey;
    });
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST", err);
  } finally {
    return pubKeyList;
  }
}

const getGraphQLQuery = (txhashes: string[]) => {
  const requestBody = {
    query: `query validators($txhashes: [Bytes!]) {  validatorAddeds(
        where: {transactionHash_in: $txhashes}
      ) {
        publicKey
      }
    }`,
    variables: { txhashes: txhashes },
  };

  return requestBody;
};
