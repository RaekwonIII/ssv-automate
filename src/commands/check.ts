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

export const check = new Command("check");

type OperatorPrivateInfo = {
  id: number;
  fee: number;
  isPrivate: boolean;
  whitelisted: string[];
};

check
  .version("0.0.1", "-v, --vers", "output the current version")
  .option(
    "-o, --operators <operators>",
    "comma separated list of ids of operators to test",
    commaSeparatedList
  )
  .action(async (options) => {
    spinnerInfo(figlet.textSync("SSV Automate"));
    console.log("Automating verification of Operator registrations\n");
    if (!options.operators) throw Error("No operator IDs provided");

    let operatorsList = options.operators.sort();

    console.log(operatorsList);
    let operators: Set<string> = new Set([
      ...operatorsList.map((item: string) => item),
    ]);
    let operatorsPrivateInfoArray = await getOperatorsPrivateInfo(
      Array.from(operators)
    );

    updateSpinnerText(
      `Looping through the provided operator IDs to verify their private status \n`
    );

    let problems = new Map();
    for (const operatorPrivateInfo of operatorsPrivateInfoArray) {
      if (operatorPrivateInfo.whitelisted.length == 0) {
        console.error(
          `Operator ${operatorPrivateInfo.id} did not whitelist any address`
        );
        problems.set(
          operatorPrivateInfo.id,
          `Operator ${operatorPrivateInfo.id} did not whitelist any address`
        );
      }

      if (operatorPrivateInfo.fee > 0) {
        console.error(
          `Operator ${operatorPrivateInfo.id} has a non-zero fee: ${operatorPrivateInfo.fee}`
        );
        problems.set(
          operatorPrivateInfo.id,
          `Operator ${operatorPrivateInfo.id} has a non-zero fee: ${operatorPrivateInfo.fee}`
        );
      }
      stopSpinner();
    }

    // for (let problem of problems) {
    //   console.error(`Encountered issue with Operator ${problem[0]}:\n${problem[1]}`);
    // }

    updateSpinnerText(
      `Encountered ${problems.size} problem(s)\n`
    );
    console.error(
      `Operator IDs with errors: ${[...problems.keys()].join(", ")}\n`
    );
    updateSpinnerText(
      `Good operators: ${[...operators].filter(x => ![...problems.keys()].includes(x)).join(", ")}\n`
    );

    console.log("Done.");

    spinnerSuccess();
  });

function commaSeparatedList(value: string, dummyPrevious: any) {
  return value.split(",");
}

async function getOperatorsPrivateInfo(
  operatorIDs: string[]
): Promise<OperatorPrivateInfo[]> {
  let operatorPrivateInfoArray: OperatorPrivateInfo[] = [];
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
        query MyQuery($operatorIDs: [String!] = "") {
          operators(where: {id_in: $operatorIDs}) {
            id
            fee
            isPrivate
            whitelisted {
              id
            }
          }
        }`,
        variables: { operatorIDs: operatorIDs },
      },
    });

    if (response.status !== 200) throw Error("Request did not return OK");
    if (!response.data.data.operators) throw Error("Response is empty");
    
    operatorPrivateInfoArray = response.data.data.operators

    console.debug(`Found ${operatorPrivateInfoArray.length} operators`);
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST", err);
  } finally {

    return operatorPrivateInfoArray;
  }
}
