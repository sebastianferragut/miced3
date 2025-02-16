import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

let allTempData = [];
let allActData = [];
let currentView = "all"; // "all", "male", or "female"
let currentMetric = "temp"; // "temp" or "act"
let globalYDomainTemp = [0, 0];
let globalYDomainAct = [0, 0];
const margin = { top: 30, right: 30, bottom: 50, left: 60 };
const width = 1200 - margin.left - margin.right;
const height = 600 - margin.top - margin.bottom;
let svg, xScale, yScale, xAxis, yAxis;
const tooltip = d3.select("#tooltip");
const LIGHTS_OFF_COLOR = "rgba(0, 0, 0, 0.1)";
const LIGHTS_CYCLE = 720;

async function loadData() {
  const [maleTemp, femTemp, maleAct, femAct] = await Promise.all([
    d3.csv("data/male_temp.csv", rowConverter),
    d3.csv("data/fem_temp.csv", rowConverter),
    d3.csv("data/male_act.csv", rowConverter),
    d3.csv("data/fem_act.csv", rowConverter)
  ]);

  allTempData = [
    ...processMiceData(maleTemp, "male"),
    ...processMiceData(femTemp, "female")
  ];

  allActData = [
    ...processMiceData(maleAct, "male"),
    ...processMiceData(femAct, "female")
  ];

  // Calculate global Y-axis domains
  const allTempValues = allTempData.flatMap(d => d.data);
  globalYDomainTemp = [d3.min(allTempValues), d3.max(allTempValues)];

  const allActValues = allActData.flatMap(d => d.data);
  globalYDomainAct = [d3.min(allActValues), d3.max(allActValues)];

  initializeChart();
  updateChart();
}

function rowConverter(d) {
  const converted = {};
  Object.keys(d).forEach(key => (converted[key] = +d[key]));
  return converted;
}

function processMiceData(dataset, gender) {
  const miceIDs = Object.keys(dataset[0]).filter(k => k !== "minuteIndex");
  
  return miceIDs.flatMap(mouseID => {
    // Accumulators for estrus and non‑estrus minutes
    const estrusData = new Array(1440).fill(0);
    const nonEstrusData = new Array(1440).fill(0);
    let estrusDays = 0;
    let nonEstrusDays = 0;

    dataset.forEach((row, idx) => {
      const day = Math.floor(idx / 1440) + 1;
      const minute = idx % 1440;
      const isEstrus = (gender === "female") && ((day - 2) % 4 === 0);

      if (isEstrus) {
        estrusData[minute] += row[mouseID];
        if (minute === 0) estrusDays++;
      } else {
        nonEstrusData[minute] += row[mouseID];
        if (minute === 0 && gender === "female") nonEstrusDays++;
      }
    });

    // Create an entry (or two for females)
    const entries = [];
    if (gender === "female") {
      if (estrusDays > 0) {
        entries.push({
          id: mouseID,
          gender,
          type: "estrus",
          data: estrusData.map(v => v / estrusDays)
        });
      }
      if (nonEstrusDays > 0) {
        entries.push({
          id: mouseID,
          gender,
          type: "non-estrus",
          data: nonEstrusData.map(v => v / nonEstrusDays)
        });
      }
    } else {
      entries.push({
        id: mouseID,
        gender,
        type: "male",
        data: nonEstrusData.map(v => v / 14) // Use all days for males
      });
    }
    return entries;
  });
}

function initializeChart() {
  svg = d3.select("#chart-container")
    .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  // Time scale for the day
  xScale = d3.scaleTime()
    .domain([new Date(2023, 0, 1), new Date(2023, 0, 1, 23, 59)])
    .range([0, width]);

  // y‑scale based on the current metric
  if (currentMetric === "temp") {
    yScale = d3.scaleLinear()
      .domain([globalYDomainTemp[0] * 0.98, globalYDomainTemp[1] * 1.02])
      .range([height, 0]);
  } else {
    yScale = d3.scaleLinear()
      .domain([globalYDomainAct[0] * 0.98, globalYDomainAct[1] * 1.02])
      .range([height, 0]);
  }

  // Light/dark background blocks
  const startTime = new Date(2023, 0, 1);
  [0, 1].forEach(i => {
    const start = new Date(startTime.getTime() + i * LIGHTS_CYCLE * 60000);
    const end = new Date(start.getTime() + LIGHTS_CYCLE * 60000);
    svg.append("rect")
      .attr("x", xScale(start))
      .attr("width", xScale(end) - xScale(start))
      .attr("height", height)
      .attr("fill", i % 2 === 0 ? LIGHTS_OFF_COLOR : "none");
  });

  // Axes
  xAxis = svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(
      d3.axisBottom(xScale)
        .ticks(d3.timeHour.every(3))
        .tickFormat(d3.timeFormat("%-I %p"))
    );
    
  yAxis = svg.append("g")
    .call(d3.axisLeft(yScale));

  // y‑axis label
  svg.append("text")
    .attr("class", "y-axis-label")
    .attr("transform", "rotate(-90)")
    .attr("y", -margin.left + 15)
    .attr("x", -height / 2)
    .style("text-anchor", "middle")
    .text(currentMetric === "temp" ? "Temperature (°C)" : "Activity");
}

function updateChart() {
  let filteredData, yDomain;
  if (currentMetric === "temp") {
    filteredData = allTempData.filter(d => currentView === "all" || d.gender === currentView);
    yDomain = globalYDomainTemp;
  } else {
    filteredData = allActData.filter(d => currentView === "all" || d.gender === currentView);
    yDomain = globalYDomainAct;
  }

  // Update y‑scale and axis
  yScale.domain([yDomain[0] * 0.98, yDomain[1] * 1.02]);
  yAxis.transition().duration(500).call(d3.axisLeft(yScale));

  // Line generator
  const line = d3.line()
    .x((_, i) => xScale(new Date(2023, 0, 1, 0, i)))
    .y(d => yScale(d))
    .curve(d3.curveMonotoneX);

  // NOTE: Including currentMetric in the key forces a full update when the metric changes.
  const lines = svg.selectAll(".mouse-line")
    .data(filteredData, d => `${currentMetric}-${d.id}-${d.type}`);

  // Enter new lines
  lines.enter()
    .append("path")
      .attr("class", "mouse-line")
      .attr("fill", "none")
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.7)
      .on("mouseover", showTooltip)
      .on("mousemove", moveTooltip)
      .on("mouseout", hideTooltip)
    .merge(lines)
    .transition().duration(500)
      .attr("d", d => line(d.data))
      .attr("stroke", d => {
        if (d.gender === "male") return "#3690c0"; // Blue for males
        return d.type === "estrus" ? "#ff0000" : "#ffa500"; // Red or orange for females
      });

  // Remove old lines
  lines.exit().remove();

  // Update y‑axis label
  svg.selectAll("text.y-axis-label").remove();
  svg.append("text")
    .attr("class", "y-axis-label")
    .attr("transform", "rotate(-90)")
    .attr("y", -margin.left + 15)
    .attr("x", -height / 2)
    .style("text-anchor", "middle")
    .text(currentMetric === "temp" ? "Temperature (°C)" : "Activity");
}

function showTooltip(event, mouse) {
  const hoveredId = mouse.id;
  
  // Highlight all lines for the hovered mouse
  d3.selectAll(".mouse-line")
    .filter(d => d.id === hoveredId)
    .attr("opacity", 1)
    .attr("stroke-width", 2.5);

  // Dim all other lines
  d3.selectAll(".mouse-line")
    .filter(d => d.id !== hoveredId)
    .attr("opacity", 0.1);

  tooltip.style("opacity", 1)
    .html(`
      <strong>${mouse.id}</strong><br>
      Gender: ${mouse.gender}<br>
      ${mouse.type ? `Type: ${mouse.type.replace("-", " ")}` : ""}
    `);
}

function moveTooltip(event) {
  tooltip.style("left", `${event.pageX + 15}px`)
         .style("top", `${event.pageY - 15}px`);
}

function hideTooltip() {
  d3.selectAll(".mouse-line")
    .attr("opacity", 0.7)
    .attr("stroke-width", 1.5);
  tooltip.style("opacity", 0);
}

document.addEventListener("DOMContentLoaded", () => {
  loadData();

  // View filter buttons
  d3.select("#allBtn").on("click", () => {
    currentView = "all";
    updateChart();
  });
  d3.select("#maleBtn").on("click", () => {
    currentView = "male";
    updateChart();
  });
  d3.select("#femaleBtn").on("click", () => {
    currentView = "female";
    updateChart();
  });

  // Metric switch buttons
  d3.select("#tempBtn").on("click", () => {
    currentMetric = "temp";
    updateChart();
  });
  d3.select("#actBtn").on("click", () => {
    currentMetric = "act";
    updateChart();
  });
});
