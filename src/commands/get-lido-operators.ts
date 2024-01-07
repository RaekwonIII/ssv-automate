import { Command } from "commander";
import figlet from "figlet";
import axios from "axios";

export const getLidoOperators = new Command("operators");

getLidoOperators
  .version("0.0.1", "-v, --vers", "output the current version")
  .argument("<owner>", "the address of the cluster owner")
  .action(async (owner, options) => {
    console.info(figlet.textSync("Get Lido Operators"));
    // spinnerInfo(`Obtaining Lido operators\n`);
    console.log(`Obtaining Lido operators\n${process.env.SSV_API}/operators?page=1&perPage=500&ordering=id%3Aasc&search=Lido%20-&has_dkg_address=false`);

    let response = await axios({
      method: "GET",
      url: `${process.env.SSV_API}/operators?page=1&perPage=500&ordering=id%3Aasc&search=Lido%20-`,
      headers: {
        "content-type": "application/json",
      },
    });

    // console.log(response)

    if (response.status !== 200) throw Error("Request did not return OK");
    // generate a map with {id: {operator info}}
    let lidoOperatorsInfo = 
      response.data.operators.map(
        (operator: { id: any; public_key: any; dkg_address: any }) => 
          operator.id
    );

    console.log(lidoOperatorsInfo)
  });

function commaSeparatedList(value: string, dummyPrevious: any) {
  return value.split(",");
}

async function getLidoperatorsInfo(): Promise<Map<
  number,
  { id: number; public_key: string; dkg_address: string }
>> {
  let lidoOperatorsInfo: Map<
    number,
    { id: number; public_key: string; dkg_address: string }
  > = new Map();
  let response;
  try {
    // Fetch all operators that have "Lido -" in their name
    // https://api.ssv.network/api/v4/holesky/operators?page=1&perPage=5000&ordering=id%3Aasc&search=Lido%20-

    // console.log(`Request to URL: ${process.env.SSV_API}/operators?page=1&perPage=500&ordering=id%3Aasc&search=Lido%20-`)

    response = await axios({
      method: "GET",
      url: `${process.env.SSV_API}/operators?page=1&perPage=500&ordering=id%3Aasc&search=Lido%20-`,
      headers: {
        "content-type": "application/json",
      },
    });

    if (response.status !== 200) throw Error("Request did not return OK");
    // generate a map with {id: {operator info}}
    lidoOperatorsInfo = new Map(
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
    // spinnerError();
    // stopSpinner();
    console.error("ERROR DURING AXIOS REQUEST");
  }
  console.log("stuff ")
  return lidoOperatorsInfo;
}
