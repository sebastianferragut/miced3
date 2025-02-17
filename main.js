import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Instead of a single "currentView", we now use an object to store which groups are enabled.
let allTempData = [];
let selectedFilters = {
  male: true,
  estrus: true,
  "non-estrus": true
};

const margin = { top: 30, right: 30, bottom: 60, left: 60 };
let width = window.innerWidth * 0.8 - margin.left - margin.right;
let height = window.innerHeight * 0.6 - margin.top - margin.bottom;
let svg, xScale, yScale, xAxis, yAxis;
let originalXDomain, originalYDomain; // for reset
// constantXScale remains for positioning static elements (like labels)
let constantXScale;
const tooltip = d3.select("#tooltip")
  .style("position", "absolute")
  .style("pointer-events", "none")
  .style("opacity", 0);

const LIGHTS_OFF_COLOR = "rgba(0, 0, 0, 0.1)";
let globalYDomain;

// Precompute an array of Date objects—one for each minute in the day.
const times = d3.range(1440).map(i => new Date(2023, 0, 1, 0, i));

// For the full-day view, define custom ticks.
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

// Custom tick format: if tick is exactly 11:59 pm, show that text.
const customTimeFormat = d => {
  if (d.getHours() === 23 && d.getMinutes() === 59) {
    return "11:59 pm";
  }
  return d3.timeFormat("%-I %p")(d);
};

function updateDimensions() {
  // Update width and height based on current window dimensions.
  width = window.innerWidth * 0.8 - margin.left - margin.right;
  height = Math.max(window.innerHeight * 0.6 - margin.top - margin.bottom, 400); // Set a minimum height of 400px

  // Update SVG dimensions.
  d3.select("svg")
    .attr("width", width + margin.left + margin.right + 150) // Extra space for legend
    .attr("height", height + margin.top + margin.bottom + 40); // Extra space for x-axis label

  // Update scales with new ranges.
  xScale.range([0, width]);
  yScale.range([height, 0]);

  // Update axes.
  xAxis.attr("transform", `translate(0,${height})`).call(
    d3.axisBottom(xScale)
      .tickValues(fullDayTicks)
      .tickFormat(customTimeFormat)
  );
  yAxis.call(d3.axisLeft(yScale));

  // Update clipPath rectangle.
  d3.select("#clip rect")
    .attr("width", width)
    .attr("height", height);

  // Update background rectangle.
  svg.select("rect.background")
    .attr("width", width)
    .attr("height", height);

  // Update Light On/Off text positions.
  d3.select(".lightOnLabel")
    .attr("x", constantXScale(new Date(2023, 0, 1, 6, 0))); // Light On at 6am
  d3.select(".lightOffLabel")
    .attr("x", constantXScale(new Date(2023, 0, 1, 18, 0))); // Light Off at 6pm

  // Update x-axis and y-axis label positions.
  d3.select(".x-axis-label")
    .attr("x", width / 2)
    .attr("y", height + margin.bottom - 10);
  d3.select(".y-axis-label")
    .attr("x", -height / 2)
    .attr("y", -margin.left + 15);

  // Update brush extent.
  svg.select(".brush").call(d3.brushX().extent([[0, 0], [width, height]]));

  // **Move the legend to the right of the graph**
  d3.select(".legend")
    .attr("transform", `translate(${width + 20}, 20)`); // Place legend to the right

  // Redraw background and the chart (including lines).
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

  // Add a clipPath so that lines are contained.
  svg.append("defs")
    .append("clipPath")
      .attr("id", "clip")
    .append("rect")
      .attr("width", width)
      .attr("height", height);

  // xScale is time-based. Domain from 12:00 am to 11:59 pm.
  xScale = d3.scaleTime()
    .domain([new Date(2023, 0, 1, 0, 0), new Date(2023, 0, 1, 23, 59)])
    .range([0, width]);

  // yScale based on global data.
  yScale = d3.scaleLinear()
    .domain([globalYDomain[0] * 0.98, globalYDomain[1] * 1.02])
    .range([height, 0]);

  // Save original domains.
  originalXDomain = xScale.domain();
  originalYDomain = yScale.domain();

  // Create a constant scale for positioning static elements (like labels)
  constantXScale = d3.scaleTime()
    .domain(originalXDomain)
    .range([0, width]);

  // Draw a grey background rectangle for "lights off".
  svg.append("rect")
    .attr("class", "background")
    .attr("y", 0)
    .attr("height", height)
    .attr("fill", LIGHTS_OFF_COLOR);

  // Add labels for the lighting conditions.
  // "Light On" covers midnight to noon (white background).
  svg.append("text")
    .attr("class", "lightOnLabel")
    .attr("x", constantXScale(new Date(2023, 0, 1, 6, 0))) // midpoint of 12 am–12 pm
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("fill", "#333")
    .style("font-size", "16px")
  // "Light Off" covers 12:00 pm to 11:59 pm (grey background).
  svg.append("text")
    .attr("class", "lightOffLabel")
    .attr("x", constantXScale(new Date(2023, 0, 1, 18, 0))) // midpoint of 12 pm–11:59 pm
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("fill", "#333")
    .style("font-size", "16px")

  // Add x-axis title: "Time of Day"
  svg.append("text")
    .attr("class", "x-axis-label")
    .attr("x", width / 2)
    .attr("y", height + margin.bottom - 10)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("fill", "#333")
    .text("Time of Day");

  // Draw axes. For the full-day view, force our custom tick values.
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

  // Add a legend for "Light On" and "Light Off".
  const legend = svg.append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${width - 120}, 10)`);

  // Legend item for Light On (white)
  legend.append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", 20)
    .attr("height", 20)
    .attr("fill", "white")
    .attr("stroke", "black");

  legend.append("text")
    .attr("x", 25)
    .attr("y", 15)
    .style("font-size", "12px")
    .attr("fill", "#333")
    .text("Light On");


  // Legend item for Light Off (grey)
  legend.append("rect")
    .attr("x", 0)
    .attr("y", 25)
    .attr("width", 20)
    .attr("height", 20)
    .attr("fill", LIGHTS_OFF_COLOR)
    .attr("stroke", "black");
    

  legend.append("text")
    .attr("x", 25)
    .attr("y", 40)
    .style("font-size", "12px")
    .attr("fill", "#333")
    .text("Light Off");

  // Add a brush along the x-axis.
  const brush = d3.brushX()
    .extent([[0, 0], [width, height]])
    .on("end", brushed);
  svg.append("g")
    .attr("class", "brush")
    .call(brush);

  // Initial background update.
  updateBackground();
}

function updateBackground() {
  // Set the grey interval to represent "lights off": 12:00 pm to 11:59 pm.
  const greyStart = new Date(2023, 0, 1, 12, 0);
  const greyEnd = new Date(2023, 0, 1, 23, 59);

  // Get the currently visible time range from xScale.
  const currentDomain = xScale.domain();

  // Calculate the overlap between the visible domain and the fixed grey interval.
  const overlapStart = currentDomain[0] > greyStart ? currentDomain[0] : greyStart;
  const overlapEnd = currentDomain[1] < greyEnd ? currentDomain[1] : greyEnd;

  // If there is an overlap, draw the grey rectangle to cover that portion.
  if (overlapStart < overlapEnd) {
    const x = xScale(overlapStart);
    const w = xScale(overlapEnd) - xScale(overlapStart);
    svg.select("rect.background")
      .attr("x", x)
      .attr("width", w)
      .attr("visibility", "visible");
  } else {
    // No overlap: hide the grey rectangle.
    svg.select("rect.background")
      .attr("visibility", "hidden");
  }
}

// Dynamically update the x-axis ticks based on the zoom level.
function updateXAxis() {
  const currentDomain = xScale.domain();
  const domainDuration = currentDomain[1] - currentDomain[0];

  // If we're at the full-day view, use the custom fullDayTicks.
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

    if (domainDuration > sixHours) {
      // For zoom levels spanning more than 6 hours, show ticks every hour.
      tickInterval = d3.timeHour.every(1);
      tickFormat = d3.timeFormat("%-I %p");
    } else if (domainDuration > oneHour) {
      // For zoom levels spanning between 1 and 6 hours, show ticks every 15 minutes.
      tickInterval = d3.timeMinute.every(15);
      tickFormat = d3.timeFormat("%-I:%M %p");
    } else if (domainDuration > tenMinutes) {
      // For zoom levels spanning between 10 minutes and 1 hour, show ticks every 5 minutes.
      tickInterval = d3.timeMinute.every(5);
      tickFormat = d3.timeFormat("%-I:%M %p");
    } else {
      // For very zoomed-in views (less than 10 minutes), show ticks every minute.
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

function getFilteredData() {
  // Filter based on the selected filters.
  return allTempData.filter(d => {
    if (d.gender === "male") return selectedFilters.male;
    if (d.gender === "female") {
      if (d.type === "estrus") return selectedFilters.estrus;
      if (d.type === "non-estrus") return selectedFilters["non-estrus"];
    }
    return false;
  });
}

function updateChart() {
  const filteredData = getFilteredData();

  // Reset y-scale to global domain.
  yScale.domain([globalYDomain[0] * 0.98, globalYDomain[1] * 1.02]);
  yAxis.transition().duration(250).call(d3.axisLeft(yScale));
  updateXAxis();
  updateBackground();

  // Create a line generator using our precomputed time array.
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
      if (d.gender === "male") return "#3690c0";
      return d.type === "estrus" ? "#ff0000" : "#ffa500";
    });

  // Remove old lines.
  lines.exit().remove();
}

function brushed(event) {
  if (!event.selection) return; // exit if no selection

  const [x0, x1] = event.selection;
  const newXDomain = [xScale.invert(x0), xScale.invert(x1)];
  xScale.domain(newXDomain);

  // Compute corresponding minute indices.
  const startIndex = Math.max(0, Math.floor((newXDomain[0] - new Date(2023, 0, 1)) / 60000));
  const endIndex = Math.min(1439, Math.ceil((newXDomain[1] - new Date(2023, 0, 1)) / 60000));

  // Recompute y domain based on data in the selected time window.
  const filteredData = getFilteredData();
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

  updateXAxis();
  yAxis.transition().duration(500).call(d3.axisLeft(yScale));
  updateBackground();

  // Update lines.
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
  // Reset scales to original domains.
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

  // Listen to changes in the checkboxes.
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

  // Reset brush button.
  d3.select("#resetBrush").on("click", resetBrush);
});

// Resize the chart when the window resizes
window.addEventListener("resize", updateDimensions);
