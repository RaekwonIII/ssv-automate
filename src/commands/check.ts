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
  operatorId: number;
  whitelisted: string;
  fee: number;
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
    let operators: Set<number> = new Set([
      ...operatorsList.map((item: string) => parseInt(item)),
    ]);
    let operatorsPrivateInfoArray = await getOperatorsPrivateInfo(
      Array.from(operators)
    );

    updateSpinnerText(
      `Looping through the provided operator IDs to verify their private status \n`
    );

    let problems = new Map();
    for (const operatorPrivateInfo of operatorsPrivateInfoArray) {
      if (!operatorPrivateInfo.whitelisted) {
        console.error(
          `Operator ${operatorPrivateInfo.operatorId} did not whitelist any address`
        );
        problems.set(
          operatorPrivateInfo.operatorId,
          `Operator ${operatorPrivateInfo.operatorId} did not whitelist any address`
        );
      }

      if (operatorPrivateInfo.fee > 0) {
        console.error(
          `Operator ${operatorPrivateInfo.operatorId} has a non-zero fee: ${operatorPrivateInfo.fee}`
        );
        problems.set(
          operatorPrivateInfo.operatorId,
          `Operator ${operatorPrivateInfo.operatorId} has a non-zero fee: ${operatorPrivateInfo.fee}`
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
  operatorIDs: number[]
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
            query operatorsWhitelistUpdates($operatorIDs: [Int]!) {
              operatorWhitelistUpdateds(
                where: {operatorId_in:  $operatorIDs}
              ) {
                operatorId
                whitelisted
              }
              operatorFeeExecuteds(
                where: {operatorId_in:  $operatorIDs}
              ) {
                fee
                operatorId
              }
            }`,
        variables: { operatorIDs: operatorIDs },
      },
    });

    if (response.status !== 200) throw Error("Request did not return OK");
    if (!response.data.data.operatorWhitelistUpdateds && response.data.data.operatorFeeExecuteds) throw Error("Response is empty");

    // We have two separate lists of dishomogeneus results. The only link between them is the operator ID.
    // Generate map with the first list of results
    let operatorPrivateInfoMap: Map<string, OperatorPrivateInfo> = new Map(response.data.data.operatorFeeExecuteds.map(
      (x: { operatorId: string; fee: string; }) => {
        console.log(`Operator: ${x.operatorId} has fee ${x.fee}`)
        return [x.operatorId, {
          operatorId: parseInt(x.operatorId),
          whitelisted: "",
          fee: parseInt(x.fee),
      }]
      }
    ));
    // iterate over second list and back-fill the map with the results found in it.
    response.data.data.operatorWhitelistUpdateds.map((x: { operatorId: string; whitelisted: string; }) => {
      let i: OperatorPrivateInfo | undefined = operatorPrivateInfoMap.get(x.operatorId)
      if (i) i.whitelisted = x.whitelisted
    })

    operatorPrivateInfoArray = [...operatorPrivateInfoMap.values()].sort((a, b) => a.operatorId - b.operatorId);

    console.debug(`Found ${operatorPrivateInfoArray.length} operators`);
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST", err);
  } finally {

    return operatorPrivateInfoArray;
  }
}
