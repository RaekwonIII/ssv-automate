import { Command } from "commander";
import figlet from "figlet";
import axios from "axios";

export const getNewOperators = new Command("new");

getNewOperators
  .version("0.0.1", "-v, --vers", "output the current version")
  .argument("<owner>", "the address of the cluster owner")
  .option(
    "-o, --operators <operators>",
    "comma separated list of ids of operators to test",
    commaSeparatedList
  )
  .action(async (owner, options) => {
    console.info(figlet.textSync("Get New Operators"));
    let operators = options.operators.map((item: string) => parseInt(item))

    let clustersOwnedBy = await getClustersOwnedBy(owner);

    console.log(`Account ${owner} has ${clustersOwnedBy?.length} clusters`);

   let newLidoOperatorsInfo = getNewLidoOperators(operators, clustersOwnedBy);
   console.log("New operators:")
   console.log(newLidoOperatorsInfo)
  });

function commaSeparatedList(value: string, dummyPrevious: any) {
  return value.split(",");
}

async function getClustersOwnedBy(
  owner: string
): Promise<{ id: number; operators: number[] }[] | undefined> {
  // fetch all clusters owned by provided address
  // https://api.ssv.network/api/v4/holesky/clusters/owner/0xaA184b86B4cdb747F4A3BF6e6FCd5e27c1d92c5c?page=1&perPage=10&ordering=id%3Aasc
  try {
    const firstPageResponse = await axios({
      method: "GET",
      url: `${process.env.SSV_API}/clusters/owner/${owner}?page=1&perPage=100&ordering=id%3Aasc`,
      headers: {
        "content-type": "application/json",
      },
    });

    if (firstPageResponse.status !== 200) throw Error("Request did not return OK");

    // return an array of objects {cluster_id, list_of_operator_ids_in_cluster}
    let firstPage = firstPageResponse.data.clusters.map(
      (cluster: { id: any; operators: number[] }) => {
        return {
          id: cluster.id,
          operators: cluster.operators,
        };
      }
    );
    const secondPageResponse = await axios({
      method: "GET",
      url: `${process.env.SSV_API}/clusters/owner/${owner}?page=2&perPage=100&ordering=id%3Aasc`,
      headers: {
        "content-type": "application/json",
      },
    });

    if (secondPageResponse.status !== 200) throw Error("Request did not return OK");

    // return an array of objects {cluster_id, list_of_operator_ids_in_cluster}
    let secondPage = secondPageResponse.data.clusters.map(
      (cluster: { id: any; operators: number[] }) => {
        return {
          id: cluster.id,
          operators: cluster.operators,
        };
      }
    );
    return Array.from(new Set([...firstPage, ...secondPage]))
  } catch (err) {
    console.error("ERROR DURING AXIOS REQUEST");
  }
}

function getNewLidoOperators(
  lidoOperators: number[],
  clustersOwned: any[] | undefined
): number[]
 {
  // generate empty map if there is no overlap (all Lido operators appear in a cluster of this user)
  let difference: number[]= []

  if (lidoOperators && clustersOwned) {
    // flatten the array of arrays of operator IDs in various clusters and remove duplicates (Set)
    let operatorIDsInOwnedClusters = Array.from(new Set(
      clustersOwned
        .map((item) => item.operators)
        .reduce(
          (accumulator: number[], value: number[]) => accumulator.concat(value),
          []
        )
    ));
    console.log("All operators in clusters from provided user:")
    console.log(operatorIDsInOwnedClusters)
   difference = lidoOperators.filter(x => !operatorIDsInOwnedClusters.includes(x))
  }

  return difference;
}
