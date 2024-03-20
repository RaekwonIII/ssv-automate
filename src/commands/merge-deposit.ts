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
  .action(async (folder, txhashes) => {
    console.info(figlet.textSync("Simple DVT Merge Deposit files"));

    getGraphQLQuery(txhashes.txhashes);
    let pubKeyList = await getPubKeysFromTxHashes(txhashes.txhashes);
    console.debug(`Found ${pubKeyList.length} public keys from ${txhashes.length} transactions`)
    console.debug(pubKeyList);

    pubKeyList = [
      "0x8d49227c8996e944420733627fb5b07c08d5ea98d8f61c435522717909feae190c1ce13163238debb73f1266db9faab8",
      "0xac7e1595cfd5462699f0baf52b9cb8da5f12d611f679f9bad077413cdf54617245949c0fb19c4445ddc776aa9f8077ac",
    ];

    console.log(`Searching for deposit files in folder:\n${folder}`)
    let depositFilesPathList = await glob(`${folder}/**/deposit_data.json`, {
      nodir: true,
      ignore: {
        ignored: (p) => {
          const pp = p.parent;
          return !pubKeyList.includes(pp?.name.split("-")[1] || "");
        }
      },
    });
    console.debug(`Found ${depositFilesPathList.length} deposit files for the ${pubKeyList.length} public keys`)

    console.log(depositFilesPathList);
    let depositFilesObjectsLits = depositFilesPathList.map(
     (depositFilesPath) => {
        return JSON.parse(readFileSync(depositFilesPath, 'utf-8'))[0]
      }
    );
    var date = new Date();
    var month = date.getMonth() + 1; // "+ 1" because the 1st month is 0
    var day = date.getDate();
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var seconds = date.getSeconds();
    const filename = `./deposit_data-${date.getFullYear()}-${
        (month < 10 ? "0" : "") + month
      }-${(day < 10 ? "0" : "") + day}T${(hours < 10 ? "0" : "") + hours}:${
        (minutes < 10 ? "0" : "") + minutes
      }:${(seconds < 10 ? "0" : "") + seconds}Z.json`;

    console.debug(`Writing deposit file data to file: ${filename}`)
    // console.log(depositFilesObjectsLits)
    writeFile(filename, JSON.stringify(depositFilesObjectsLits),(err) => {
        if (err) {
            console.error(err);
        } else {
            // console.log("Initialized CSV file with columns")
        }
    })
    console.debug("Done.")
  });

async function getPubKeysFromTxHashes(txhashes: string[]): Promise<string[]> {
    const http = axiosRateLimit(axios.create(), { maxRPS: 1 });
    const url=
    process.env.SUBGRAPH_API ||
    "https://api.thegraph.com/subgraphs/name/raekwoniii/ssv-mainnet"

  let pubKeyList: string[] = [];
  try {
    const response = await http.post(
        url, getGraphQLQuery(txhashes),{
            headers: {
              "content-type": "application/json",
            },
            
        }
    );
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
    // query: `query validators {  validatorAddeds(
    //     where: {transactionHash_in: ["${txhashes.join('","')}"]}
    //   ) {
    //     publicKey
    //   }
    // }`,
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
