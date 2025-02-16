import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

let allTempData = [];
let currentView = "all"; // "all", "male", "female", or "estrus"
const margin = { top: 30, right: 30, bottom: 50, left: 60 };
const width = 1200 - margin.left - margin.right;
const height = 600 - margin.top - margin.bottom;
let svg, xScale, yScale, xAxis, yAxis;
let originalXDomain, originalYDomain; // store initial domains for reset
const tooltip = d3.select("#tooltip")
  .style("position", "absolute")
  .style("pointer-events", "none")
  .style("opacity", 0);

const LIGHTS_OFF_COLOR = "rgba(0, 0, 0, 0.1)";
const LIGHTS_CYCLE = 720;
let globalYDomain;

// Precompute an array of Date objects—one for each minute in the day.
const times = d3.range(1440).map(i => new Date(2023, 0, 1, 0, i));

async function loadData() {
  const [maleTemp, femTemp] = await Promise.all([
    d3.csv("data/male_temp.csv", rowConverter),
    d3.csv("data/fem_temp.csv", rowConverter)
  ]);

  allTempData = [
    ...processMiceData(maleTemp, "male"),
    ...processMiceData(femTemp, "female")
  ];

  // Compute the overall y domain using all data.
  const allTempValues = allTempData.flatMap(d => d.data);
  globalYDomain = [d3.min(allTempValues), d3.max(allTempValues)];

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
        data: nonEstrusData.map(v => v / 14)
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

  // Add a clipPath so that lines are contained within the chart area.
  svg.append("defs")
    .append("clipPath")
      .attr("id", "clip")
    .append("rect")
      .attr("width", width)
      .attr("height", height);

  // xScale is time-based.
  xScale = d3.scaleTime()
    .domain([new Date(2023, 0, 1), new Date(2023, 0, 1, 23, 59)])
    .range([0, width]);

  // yScale based on the global data.
  yScale = d3.scaleLinear()
    .domain([globalYDomain[0] * 0.98, globalYDomain[1] * 1.02])
    .range([height, 0]);

  // Save original domains for resetting.
  originalXDomain = xScale.domain();
  originalYDomain = yScale.domain();

  // Light/dark background.
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

  // Draw axes.
  xAxis = svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(
      d3.axisBottom(xScale)
        .ticks(d3.timeHour.every(3))
        .tickFormat(d3.timeFormat("%-I %p"))
    );
    
  yAxis = svg.append("g")
    .call(d3.axisLeft(yScale));

  svg.append("text")
    .attr("class", "y-axis-label")
    .attr("transform", "rotate(-90)")
    .attr("y", -margin.left + 15)
    .attr("x", -height / 2)
    .style("text-anchor", "middle")
    .text("Temperature (°C)");

  // Add a brush along the x-axis for time-range selection.
  const brush = d3.brushX()
    .extent([[0, 0], [width, height]])
    .on("end", brushed);
  
  svg.append("g")
    .attr("class", "brush")
    .call(brush);
}

function updateChart() {
  const filteredData = allTempData.filter(d => 
    currentView === "all" ? (d.gender !== "female" || d.type === "non-estrus") :  
    (currentView === "female" ? d.gender === "female" :  
    (currentView === "estrus" ? d.estrus === true :  
    d.gender === currentView))
  );



  // Reset y scale to the global domain in case the view has changed.
  yScale.domain([globalYDomain[0] * 0.98, globalYDomain[1] * 1.02]);
  yAxis.transition().duration(250).call(d3.axisLeft(yScale));
  xAxis.transition().duration(250).call(d3.axisBottom(xScale));

  // Create a line generator that uses our precomputed time array.
  const lineGenerator = d3.line()
    .x((d, i) => xScale(times[i]))
    .y(d => yScale(d))
    .curve(d3.curveMonotoneX);

  const lines = svg.selectAll(".mouse-line")
    .data(filteredData, d => `${d.id}-${d.type}`);

  // Enter new lines.
  lines.enter()
    .append("path")
      .attr("class", "mouse-line")
      .attr("clip-path", "url(#clip)")
      .attr("fill", "none")
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.7)
      .on("mouseover", showTooltip)
      .on("mousemove", moveTooltip)
      .on("mouseout", hideTooltip)
    .merge(lines)
    .attr("d", d => lineGenerator(d.data))
    .attr("stroke", d => {
      if (d.gender === "male") return "#3690c0";  // Blue for males
      return d.type === "estrus" ? "#ff7f0e" : "#ff0000"; // Orange for estrus, Red for non-estrus females
    });

  // Remove old lines.
  lines.exit().remove();
}

function brushed(event) {
  if (!event.selection) return; // Exit if no selection.

  // For a time-range selection, only the x coordinates matter.
  const [x0, x1] = event.selection;
  const newXDomain = [xScale.invert(x0), xScale.invert(x1)];
  xScale.domain(newXDomain);

  // Compute the corresponding minute indices.
  const startIndex = Math.max(0, Math.floor((newXDomain[0] - new Date(2023, 0, 1)) / 60000));
  const endIndex = Math.min(1439, Math.ceil((newXDomain[1] - new Date(2023, 0, 1)) / 60000));

  // Recompute the y domain based on data in the selected time window.
  const filteredData = allTempData.filter(d => currentView === "all" || d.gender === currentView);
  let yMin = Infinity, yMax = -Infinity;
  filteredData.forEach(d => {
    const subData = d.data.slice(startIndex, endIndex + 1);
    const localMin = d3.min(subData);
    const localMax = d3.max(subData);
    if (localMin < yMin) yMin = localMin;
    if (localMax > yMax) yMax = localMax;
  });
  if (yMin === Infinity || yMax === -Infinity) {
    yMin = globalYDomain[0];
    yMax = globalYDomain[1];
  }
  yScale.domain([yMin * 0.98, yMax * 1.02]);

  // Update axes.
  xAxis.transition().duration(500).call(d3.axisBottom(xScale));
  yAxis.transition().duration(500).call(d3.axisLeft(yScale));

  // Update lines using the same line generator.
  const lineGenerator = d3.line()
    .x((d, i) => xScale(times[i]))
    .y(d => yScale(d))
    .curve(d3.curveMonotoneX);

  svg.selectAll(".mouse-line")
    .transition().duration(500)
    .attr("d", d => lineGenerator(d.data));

  // Clear the brush selection.
  svg.select(".brush").call(d3.brush().move, null);
}

function resetBrush() {
  // Reset scales to their original domains.
  xScale.domain(originalXDomain);
  yScale.domain(originalYDomain);

  xAxis.transition().duration(500).call(d3.axisBottom(xScale));
  yAxis.transition().duration(500).call(d3.axisLeft(yScale));

  const lineGenerator = d3.line()
    .x((d, i) => xScale(times[i]))
    .y(d => yScale(d))
    .curve(d3.curveMonotoneX);

  svg.selectAll(".mouse-line")
    .transition().duration(500)
    .attr("d", d => lineGenerator(d.data));
}

function showTooltip(event, mouse) {
  const hoveredId = mouse.id;
  
  d3.selectAll(".mouse-line")
    .filter(d => d.id === hoveredId)
    .attr("opacity", 1)
    .attr("stroke-width", 2.5);

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

  // Button event handlers.
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
  d3.select("#estrusBtn").on("click", () => {
    currentView = "estrus";
    updateChart();
  });

  // Reset brush button.
  d3.select("#resetBrush").on("click", resetBrush);
});
