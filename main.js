import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Global variables for processed data
let maleTempAverages, maleActAverages, femTempAverages, femActAverages;
let currentGender = "male"; // default selection

// Global variables for chart dimensions and container
const margin = { top: 20, right: 20, bottom: 50, left: 60 };
const width = 800 - margin.left - margin.right;
const height = 400 - margin.top - margin.bottom;

let svg;      // will hold the SVG container
let xScale, yScale; // global scales

// File names in the /data folder
const files = [
  "data/male_temp.csv",
  "data/male_act.csv",
  "data/fem_temp.csv",
  "data/fem_act.csv"
];

// Row conversion function for d3.csv: converts every value to a number
// and adds a minuteIndex property (absolute minute from 0 to 20159)
const rowConverter = (d, i) => {
  const newObj = {};
  for (let key in d) {
    newObj[key] = +d[key];
  }
  newObj.minuteIndex = i;
  return newObj;
};

// ----------------------------------------------------------------
// LOAD DATA
// ----------------------------------------------------------------
async function loadData() {
  // Load all CSV files in parallel using our rowConverter
  const [maleTemp, maleAct, femTemp, femAct] = await Promise.all(
    files.map(file => d3.csv(file, rowConverter))
  );

  console.log("Male Temp Data:", maleTemp);
  console.log("Male Act Data:", maleAct);
  console.log("Female Temp Data:", femTemp);
  console.log("Female Act Data:", femAct);

  // Process each dataset into averages per minute-of-day
  function processDataset(dataset) {
    // Get mouse IDs from the first row (excluding minuteIndex)
    const mouseIDs = Object.keys(dataset[0]).filter(key => key !== "minuteIndex");

    // Initialize an accumulator for each mouse (an array of 1440 zeros)
    const accumulators = {};
    mouseIDs.forEach(id => {
      accumulators[id] = new Array(1440).fill(0);
    });

    // For each row (each absolute minute), add the value to the correct minute-of-day bucket
    dataset.forEach(row => {
      const minuteOfDay = row.minuteIndex % 1440;
      mouseIDs.forEach(id => {
        accumulators[id][minuteOfDay] += row[id];
      });
    });

    // Since the data spans 14 days, each minute-of-day appears 14 times
    const numDays = dataset.length / 1440; // should be 14
    const averages = {};
    mouseIDs.forEach(id => {
      averages[id] = accumulators[id].map(sum => sum / numDays);
    });
    return averages;
  }

  // Process and assign datasets to global variables
  maleTempAverages = processDataset(maleTemp);
  maleActAverages  = processDataset(maleAct);
  femTempAverages  = processDataset(femTemp);
  femActAverages   = processDataset(femAct);

  console.log("Male Temperature Averages:", maleTempAverages);
  console.log("Male Activity Averages:", maleActAverages);
  console.log("Female Temperature Averages:", femTempAverages);
  console.log("Female Activity Averages:", femActAverages);
}

// ----------------------------------------------------------------
// INITIALIZE CHART CONTAINER & SCALES
// ----------------------------------------------------------------
function initializeChart() {
  // Create the SVG container and group element
  svg = d3.select("#visualization")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  // Set up the x-scale: minutes-of-day (0 to 1439)
  xScale = d3.scaleLinear()
    .domain([0, 1439])
    .range([0, width]);

  // yScale will be set/updated in updateChart() based on the selected data
  yScale = d3.scaleLinear().range([height, 0]);

  // Draw the chart for the first time
  updateChart();
}

// ----------------------------------------------------------------
// UPDATE CHART BASED ON SELECTION
// ----------------------------------------------------------------
function updateChart() {
  // Clear any existing chart elements
  svg.selectAll("*").remove();

  // Select the appropriate dataset based on currentGender
  // Here we use the "activity" averages (maleActAverages or femActAverages)
  const selectedData = currentGender === "male" ? maleActAverages : femActAverages;

  // Update the y-scale domain: compute global min/max for the selected dataset
  const allValues = [];
  Object.values(selectedData).forEach(arr => {
    allValues.push(...arr);
  });
  const yExtent = d3.extent(allValues);
  yScale.domain(yExtent);

  // Create and add the x-axis
  const xAxis = d3.axisBottom(xScale).ticks(10);
  svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(xAxis);

  // Create and add the y-axis
  const yAxis = d3.axisLeft(yScale);
  svg.append("g")
    .call(yAxis);

  // Add axis labels
  svg.append("text")
    .attr("x", width / 2)
    .attr("y", height + margin.bottom - 10)
    .style("text-anchor", "middle")
    .text("Minute of Day");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -margin.left + 15)
    .style("text-anchor", "middle")
    .text("Average Activity");

  // Create a line generator function
  const lineGenerator = d3.line()
    .x((d, i) => xScale(i))
    .y(d => yScale(d));

  // Plot one line per mouse
  Object.keys(selectedData).forEach(mouseID => {
    svg.append("path")
      .datum(selectedData[mouseID])
      .attr("fill", "none")
      .attr("stroke", currentGender === "male" ? "steelblue" : "crimson")
      .attr("stroke-width", 1)
      .attr("d", lineGenerator)
      .attr("class", "line")
      .attr("data-mouse", mouseID)
      .on("click", () => {
         console.log("Clicked on mouse:", mouseID);
      });
  });
}

// ----------------------------------------------------------------
// INITIALIZE: Load Data, Set Up Chart, and Add Button Functionality
// ----------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await loadData();
  initializeChart();

  // Add event listeners for gender selection buttons (assumes these buttons exist in your HTML)
  document.getElementById("maleBtn").addEventListener("click", () => {
    currentGender = "male";
    updateChart();
  });
  document.getElementById("femaleBtn").addEventListener("click", () => {
    currentGender = "female";
    updateChart();
  });
});
