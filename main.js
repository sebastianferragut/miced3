import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Global variables for data and state
let allTempData = [];
let aggregatedMale, aggregatedFemaleEstrus, aggregatedFemaleNonEstrus;
let expandedGroups = { male: false, estrus: false, "non-estrus": false };
let selectedFilters = { male: true, estrus: true, "non-estrus": true };

const margin = { top: 30, right: 30, bottom: 60, left: 60 };
// Use 55% of the window width for the chart to prevent horizontal scrolling.
let width = window.innerWidth * 0.55 - margin.left - margin.right;
let height = Math.max(window.innerHeight * 0.65 - margin.top - margin.bottom, 400);
let svg, xScale, yScale, xAxis, yAxis;
let originalXDomain, originalYDomain;
let constantXScale;
let brush; // Global brush variable
const tooltip = d3.select("#tooltip")
  .style("position", "absolute")
  .style("pointer-events", "none")
  .style("opacity", 0);

const LIGHTS_OFF_COLOR = "rgba(0, 0, 0, 0.1)";
let globalYDomain;

// Define the smoothing window (in minutes)
const SMOOTH_WINDOW = 5;

// Precompute an array of Date objects—one for each minute in the day.
const times = d3.range(1440).map(i => new Date(2023, 0, 1, 0, i));

// Custom ticks for full-day view.
const fullDayTicks = [
  new Date(2023, 0, 1, 0, 0),
  new Date(2023, 0, 1, 3, 0),
  new Date(2023, 0, 1, 6, 0),
  new Date(2023, 0, 1, 9, 0),
  new Date(2023, 0, 1, 12, 0),
  new Date(2023, 0, 1, 15, 0),
  new Date(2023, 0, 1, 18, 0),
  new Date(2023, 0, 1, 21, 0),
  new Date(2023, 0, 1, 23, 59)
];

// Custom tick format.
const customTimeFormat = d => {
  if (d.getHours() === 23 && d.getMinutes() === 59) {
    return "11:59 pm";
  }
  return d3.timeFormat("%-I %p")(d);
};

function updateDimensions() {
  width = window.innerWidth * 0.55 - margin.left - margin.right;
  height = Math.max(window.innerHeight * 0.65 - margin.top - margin.bottom, 400);

  d3.select("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom + 40);

  xScale.range([0, width]);
  yScale.range([height, 0]);

  xAxis.attr("transform", `translate(0,${height})`).call(
    d3.axisBottom(xScale)
      .tickValues(fullDayTicks)
      .tickFormat(customTimeFormat)
  );
  yAxis.call(d3.axisLeft(yScale));

  d3.select("#clip rect")
    .attr("width", width)
    .attr("height", height);

  svg.select("rect.background")
    .attr("width", width)
    .attr("height", height);

  // Update static element positions.
  d3.select(".lightOnLabel")
    .attr("x", constantXScale(new Date(2023, 0, 1, 6, 0)));
  d3.select(".lightOffLabel")
    .attr("x", constantXScale(new Date(2023, 0, 1, 18, 0)));

  d3.select(".x-axis-label")
    .attr("x", width / 2)
    .attr("y", height + margin.bottom - 10);
  d3.select(".y-axis-label")
    .attr("x", -height / 2)
    .attr("y", -margin.left + 15);

  // Update brush extent.
  svg.select(".brush").call(brush.extent([[0, 0], [width, height]]).on("end", brushed));

  updateBackground();
  updateChart();
}

async function loadData() {
  const [maleTemp, femTemp] = await Promise.all([
    d3.csv("data/male_temp.csv", rowConverter),
    d3.csv("data/fem_temp.csv", rowConverter)
  ]);

  allTempData = [
    ...processMiceData(maleTemp, "male"),
    ...processMiceData(femTemp, "female")
  ];

  // Compute overall y domain using all data.
  const allTempValues = allTempData.flatMap(d => d.data);
  globalYDomain = [d3.min(allTempValues), d3.max(allTempValues)];

  // Compute aggregated (average) lines.
  const maleData = allTempData.filter(d => d.gender === "male");
  const femaleEstrusData = allTempData.filter(d => d.gender === "female" && d.type === "estrus");
  const femaleNonEstrusData = allTempData.filter(d => d.gender === "female" && d.type === "non-estrus");

  aggregatedMale = { id: "male_avg", gender: "male", type: "male", data: computeAggregatedLine(maleData) };
  aggregatedFemaleEstrus = { id: "female_estrus_avg", gender: "female", type: "estrus", data: computeAggregatedLine(femaleEstrusData) };
  aggregatedFemaleNonEstrus = { id: "female_non_estrus_avg", gender: "female", type: "non-estrus", data: computeAggregatedLine(femaleNonEstrusData) };

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

function computeAggregatedLine(dataArray) {
  const count = dataArray.length;
  const aggregated = new Array(1440).fill(0);
  dataArray.forEach(d => {
    d.data.forEach((value, i) => {
      aggregated[i] += value;
    });
  });
  return aggregated.map(v => v / count);
}

// Smoothing function: returns a new data array with the data values averaged over a window.
function smoothData(dataArray, window_size) {
  return dataArray.map(entry => ({
    id: entry.id,
    gender: entry.gender,
    type: entry.type,
    data: entry.data.map((_, i, arr) => {
      const start = Math.max(0, i - Math.floor(window_size / 2));
      const end = Math.min(arr.length, i + Math.floor(window_size / 2) + 1);
      return d3.mean(arr.slice(start, end));
    })
  }));
}

// Returns the data to display based on the expanded state and filters.
function getChartData() {
  let chartData = [];
  const maleData = allTempData.filter(d => d.gender === "male");
  const femaleEstrusData = allTempData.filter(d => d.gender === "female" && d.type === "estrus");
  const femaleNonEstrusData = allTempData.filter(d => d.gender === "female" && d.type === "non-estrus");

  if (selectedFilters.male) {
    if (!expandedGroups.male) chartData.push(aggregatedMale);
    else chartData.push(...maleData);
  }
  if (selectedFilters.estrus) {
    if (!expandedGroups.estrus) chartData.push(aggregatedFemaleEstrus);
    else chartData.push(...femaleEstrusData);
  }
  if (selectedFilters["non-estrus"]) {
    if (!expandedGroups["non-estrus"]) chartData.push(aggregatedFemaleNonEstrus);
    else chartData.push(...femaleNonEstrusData);
  }
  return chartData;
}

function initializeChart() {
  svg = d3.select("#chart-container")
    .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  svg.append("defs")
    .append("clipPath")
      .attr("id", "clip")
    .append("rect")
      .attr("width", width)
      .attr("height", height);

  xScale = d3.scaleTime()
    .domain([new Date(2023, 0, 1, 0, 0), new Date(2023, 0, 1, 23, 59)])
    .range([0, width]);

  // Set y-scale to show the entire global data range with a little padding.
  yScale = d3.scaleLinear()
    .domain([globalYDomain[0] * 0.98, globalYDomain[1] * 1.02])
    .range([height, 0]);

  originalXDomain = xScale.domain();
  originalYDomain = yScale.domain();

  constantXScale = d3.scaleTime()
    .domain(originalXDomain)
    .range([0, width]);

  svg.append("rect")
    .attr("class", "background")
    .attr("y", 0)
    .attr("height", height)
    .attr("fill", LIGHTS_OFF_COLOR);

  svg.append("text")
    .attr("class", "lightOnLabel")
    .attr("x", constantXScale(new Date(2023, 0, 1, 6, 0)))
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("fill", "#333")
    .style("font-size", "16px");
    
  svg.append("text")
    .attr("class", "lightOffLabel")
    .attr("x", constantXScale(new Date(2023, 0, 1, 18, 0)))
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("fill", "#333")
    .style("font-size", "16px");

  svg.append("text")
    .attr("class", "x-axis-label")
    .attr("x", width / 2)
    .attr("y", height + margin.bottom - 10)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("fill", "#333")
    .text("Time of Day");

  xAxis = svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(xScale)
      .tickValues(fullDayTicks)
      .tickFormat(customTimeFormat)
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

  // Add a light conditions legend (inside the chart)
  const lightLegend = svg.append("g")
    .attr("class", "light-legend")
    .attr("transform", `translate(${width - 120}, 10)`);
    
  lightLegend.append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", 20)
    .attr("height", 20)
    .attr("fill", "white")
    .attr("stroke", "black");
    
  lightLegend.append("text")
    .attr("x", 25)
    .attr("y", 15)
    .text("Light On");
    
  lightLegend.append("rect")
    .attr("x", 0)
    .attr("y", 25)
    .attr("width", 20)
    .attr("height", 20)
    .attr("fill", LIGHTS_OFF_COLOR)
    .attr("stroke", "black");
    
  lightLegend.append("text")
    .attr("x", 25)
    .attr("y", 40)
    .text("Light Off");

  // Add a brush along the x-axis.
  brush = d3.brushX()
    .extent([[0, 0], [width, height]])
    .on("end", brushed);
  svg.append("g")
    .attr("class", "brush")
    .call(brush);

  updateBackground();
}

function updateBackground() {
  const greyStart = new Date(2023, 0, 1, 12, 0);
  const greyEnd = new Date(2023, 0, 1, 23, 59);
  const currentDomain = xScale.domain();
  const overlapStart = currentDomain[0] > greyStart ? currentDomain[0] : greyStart;
  const overlapEnd = currentDomain[1] < greyEnd ? currentDomain[1] : greyEnd;

  if (overlapStart < overlapEnd) {
    const x = xScale(overlapStart);
    const w = xScale(overlapEnd) - xScale(overlapStart);
    svg.select("rect.background")
      .attr("x", x)
      .attr("width", w)
      .attr("visibility", "visible");
  } else {
    svg.select("rect.background")
      .attr("visibility", "hidden");
  }
}

function updateXAxis() {
  const currentDomain = xScale.domain();

  if (
    currentDomain[0].getTime() === originalXDomain[0].getTime() &&
    currentDomain[1].getTime() === originalXDomain[1].getTime()
  ) {
    xAxis.transition().duration(250)
      .call(d3.axisBottom(xScale)
        .tickValues(fullDayTicks)
        .tickFormat(customTimeFormat)
      );
  } else {
    let tickInterval, tickFormat;
    const oneHour = 60 * 60 * 1000;
    const sixHours = 6 * oneHour;
    const tenMinutes = 10 * 60 * 1000;
    const domainDuration = currentDomain[1] - currentDomain[0];

    if (domainDuration > sixHours) {
      tickInterval = d3.timeHour.every(1);
      tickFormat = d3.timeFormat("%-I %p");
    } else if (domainDuration > oneHour) {
      tickInterval = d3.timeMinute.every(15);
      tickFormat = d3.timeFormat("%-I:%M %p");
    } else if (domainDuration > tenMinutes) {
      tickInterval = d3.timeMinute.every(5);
      tickFormat = d3.timeFormat("%-I:%M %p");
    } else {
      tickInterval = d3.timeMinute.every(1);
      tickFormat = d3.timeFormat("%-I:%M:%S %p");
    }

    xAxis.transition().duration(250)
      .call(d3.axisBottom(xScale)
        .ticks(tickInterval)
        .tickFormat(tickFormat)
      );
  }
}

function updateChart() {
  // Get the current chart data based on filters and expansion state...
  const chartData = getChartData();
  // Apply smoothing to all lines using the defined window size.
  const smoothedData = smoothData(chartData, SMOOTH_WINDOW);

  // Always use the full global y-domain with padding.
  yScale.domain([globalYDomain[0] * 0.98, globalYDomain[1] * 1.02]);
  yAxis.transition().duration(250).call(d3.axisLeft(yScale));
  updateXAxis();
  updateBackground();

  const lineGenerator = d3.line()
    .x((d, i) => xScale(times[i]))
    .y(d => yScale(d))
    .curve(d3.curveMonotoneX);

  const lines = svg.selectAll(".mouse-line")
    .data(smoothedData, d => d.id);

  lines.enter()
    .append("path")
      .attr("class", "mouse-line")
      .attr("clip-path", "url(#clip)")
      .attr("fill", "none")
      .attr("stroke-width", d => d.id.includes("avg") ? 3 : 1.5)
      // For individual (non-avg) lines, start with 0 opacity to animate fade-in.
      .attr("opacity", d => d.id.includes("avg") ? 0.7 : 0)
      .on("mouseover", showTooltip)
      .on("mousemove", moveTooltip)
      .on("mouseout", hideTooltip)
      .on("click", lineClicked)
    .merge(lines)
    .transition().duration(d => d.id.includes("avg") ? 250 : 600)
      .attr("d", d => lineGenerator(d.data))
      .attr("stroke", d => {
        if (d.gender === "male") return "#3690c0";
        return d.type === "estrus" ? "#ff0000" : "#ffa500";
      })
      .attr("stroke-width", d => d.id.includes("avg") ? 3 : 1.5)
      .attr("opacity", 0.7);

  lines.exit().remove();
  
  // Bring aggregated (avg) lines to the front.
  svg.selectAll(".mouse-line")
    .filter(d => d.id.includes("avg"))
    .raise();
}

function brushed(event) {
  if (!event.selection) return;
  const [x0, x1] = event.selection;
  const newXDomain = [xScale.invert(x0), xScale.invert(x1)];
  xScale.domain(newXDomain);

  // Keep the y-axis fixed.
  updateXAxis();
  yAxis.transition().duration(500).call(d3.axisLeft(yScale));
  updateBackground();

  const lineGenerator = d3.line()
    .x((d, i) => xScale(times[i]))
    .y(d => yScale(d))
    .curve(d3.curveMonotoneX);
  svg.selectAll(".mouse-line")
    .transition().duration(500)
    .attr("d", d => lineGenerator(d.data));

  svg.select(".brush").call(brush.move, null);
}

function resetBrush() {
  xScale.domain(originalXDomain);
  yScale.domain(originalYDomain);

  updateXAxis();
  yAxis.transition().duration(500).call(d3.axisLeft(yScale));
  updateBackground();

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
    .attr("stroke-width", d => d.id.includes("avg") ? 3 : 2.5);
  // Make non-hovered lines only slightly dim (opacity 0.5)
  d3.selectAll(".mouse-line")
    .filter(d => d.id !== hoveredId)
    .attr("opacity", 0.5);
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
    .attr("stroke-width", d => d.id.includes("avg") ? 3 : 1.5);
  tooltip.style("opacity", 0);
}

// Toggle expansion for a group when its line is clicked.
function lineClicked(event, d) {
  let groupKey;
  if (d.gender === "male") groupKey = "male";
  else if (d.gender === "female") groupKey = d.type; // "estrus" or "non-estrus"
  expandedGroups[groupKey] = !expandedGroups[groupKey];
  updateChart();
}

document.addEventListener("DOMContentLoaded", () => {
  loadData();
  d3.select("#resetBrush").on("click", resetBrush);

  // Legend checkbox event listeners.
  d3.select("#maleCheckbox").on("change", function() {
    selectedFilters.male = this.checked;
    updateChart();
  });
  d3.select("#estrusCheckbox").on("change", function() {
    selectedFilters.estrus = this.checked;
    updateChart();
  });
  d3.select("#nonEstrusCheckbox").on("change", function() {
    selectedFilters["non-estrus"] = this.checked;
    updateChart();
  });
});

// Resize the chart when the window resizes.
window.addEventListener("resize", function() {
  updateDimensions();
  svg.select(".brush").call(brush.move, null);
});
