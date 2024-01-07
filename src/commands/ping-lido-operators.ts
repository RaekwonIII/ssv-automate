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

export const ping = new Command("ping");

ping
  .version("0.0.1", "-v, --vers", "output the current version")
  .argument("<owner>", "the address of the cluster owner")
  .option(
    "-o, --operators <operators>",
    "comma separated list of ids of operators to test",
    commaSeparatedList
  )
  .action(async (owner, options) => {
    console.info(figlet.textSync("Ping operators"));

    // we could either get a list of operator IDs to create clusters with,
    // or find Lido operators that have not been tested yet, depending on the script argument
    console.log(options.operators)
    let operators = new Set([...options.operators.map((item: string) => parseInt(item))]);

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
        `Pinging DKG endpoing of ${operatorId} \n`
      );
      let pingRes;
      try {
        pingRes = await pingDKG(dkgOperatorInfo.dkg_address);
      } catch (error) {
        spinnerError();
        stopSpinner();
        console.error(`DKG ping failed for Operator ${operatorId}`)
        problems.set(
          operatorId,
          error
        );
        continue;
      }
      // if (!pingRes) {
      //   spinnerError();
      //   stopSpinner();
      //   console.error(`DKG Ceremony for Operator ${operatorId} did not generate a new validator`)
      //   problems.set(
      //     operatorId,
      //     `DKG Ceremony for Operator ${operatorId} did not generate a new validator`
      //   );
      //   continue;
      // }
      spinnerSuccess();
    }

    updateSpinnerText(`Encountered ${problems.size} problem(s)\nOperator IDs with errors: ${[...problems.keys()].join(", ")}\n`);
    updateSpinnerText(`Operator IDs with errors: ${[...problems.keys()].join(", ")}\n`);
    updateSpinnerText(`Good operators: ${[[...operators].filter(x => ![...problems.keys()].includes(x))].join(", ")}\n`);

    for (let problem of problems) {
      console.error(`Encountered issue with Operator ${problem[0]}`);
      console.log(problem[1].message);
    }

    // console.error(`Operator IDs with errors: ${[problems.keys()].join(", ")}`)

    spinnerSuccess();
  });

function commaSeparatedList(value: string, dummyPrevious: any) {
  return value.split(",");
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

        let lastLine = stdout.split("\n").at(-2)
        if (lastLine?.includes("ERROR")){
          // reject(new Error(`The following command failed:\n${cmd}\nError log:\n${stdout}`));
          reject(new Error(`${lastLine}`));
        }
        resolve({ stdout, stderr });
      }
    });
  });
}


async function pingDKG(
  ip: string,
) {
  let cmd = `docker run --rm "bloxstaking/ssv-dkg:latest" ping --ip ${ip}`;
  // console.debug(`Running DKG ceremony with command: \n${cmd}\n`);
  let { stdout } = await sh(cmd);
  let splitLines = stdout.split("\n")
  for (let line of splitLines) {
    console.info(`${line}`);
  }

  return 1;
}
