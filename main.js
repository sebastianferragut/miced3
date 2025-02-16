import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

let allMiceData = [];
let currentView = "all";
let globalYDomain = [0, 0];
const margin = { top: 30, right: 30, bottom: 50, left: 60 };
const width = 1200 - margin.left - margin.right;
const height = 600 - margin.top - margin.bottom;
let svg, xScale, yScale, xAxis, yAxis;
const tooltip = d3.select("#tooltip");
const LIGHTS_OFF_COLOR = "rgba(0, 0, 0, 0.1)";
const LIGHTS_CYCLE = 720;

async function loadData() {
    const [maleTemp, femTemp] = await Promise.all([
        d3.csv("data/male_temp.csv", rowConverter),
        d3.csv("data/fem_temp.csv", rowConverter)
    ]);

    allMiceData = [
        ...processMiceData(maleTemp, "male"),
        ...processMiceData(femTemp, "female")
    ];

    // Calculate global Y-axis domain
    const allValues = allMiceData.flatMap(d => d.data);
    globalYDomain = [d3.min(allValues), d3.max(allValues)];
    
    initializeChart();
    updateChart();
}

function rowConverter(d) {
    const converted = {};
    Object.keys(d).forEach(key => converted[key] = +d[key]);
    return converted;
}

function processMiceData(dataset, gender) {
    const miceIDs = Object.keys(dataset[0]).filter(k => k !== "minuteIndex");
    
    return miceIDs.flatMap(mouseID => {
        // Initialize accumulators
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

        // Create entries
        const entries = [];
        
        // For females: create both estrus and non-estrus lines
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
        } 
        // For males: single entry
        else {
            entries.push({
                id: mouseID,
                gender,
                type: "male",
                data: nonEstrusData.map(v => v / 14) // Use all days
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

    // Create time scale
    xScale = d3.scaleTime()
        .domain([new Date(2023, 0, 1), new Date(2023, 0, 1, 23, 59)])
        .range([0, width]);

    // Create linear scale with padding
    yScale = d3.scaleLinear()
        .domain([globalYDomain[0] * 0.98, globalYDomain[1] * 1.02])
        .range([height, 0]);

    // Add light/dark background
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

    // Add axes
    xAxis = svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(xScale)
            .ticks(d3.timeHour.every(3))
            .tickFormat(d3.timeFormat("%-I %p")));

    yAxis = svg.append("g")
        .call(d3.axisLeft(yScale));

    // Y-axis label
    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -margin.left + 15)
        .attr("x", -height/2)
        .style("text-anchor", "middle")
        .text("Temperature (°C)");
}

function updateChart() {
    const filteredData = allMiceData.filter(d => 
        currentView === "all" || d.gender === currentView
    );

    // Line generator
    const line = d3.line()
        .x((_, i) => xScale(new Date(2023, 0, 1, 0, i)))
        .y(d => yScale(d))
        .curve(d3.curveMonotoneX);

    // Data join
    const lines = svg.selectAll(".mouse-line")
        .data(filteredData, d => `${d.id}-${d.type}`);

    // Enter + update
    lines.enter()
        .append("path")
            .attr("class", "mouse-line")
            .merge(lines)
            .attr("d", d => line(d.data))
            .attr("fill", "none")
            .attr("stroke", d => {
                if (d.gender === "male") return "#3690c0"; // Blue for males
                return d.type === "estrus" ? "#ff0000" : "#ffa500"; // Red/Orange for females
            })
            .attr("stroke-width", 1.5)
            .attr("opacity", 0.7)
            .on("mouseover", showTooltip)
            .on("mousemove", moveTooltip)
            .on("mouseout", hideTooltip);

    // Exit
    lines.exit().remove();
}

function showTooltip(event, mouse) {
    const hoveredId = mouse.id;
    
    // Highlight all related lines
    d3.selectAll(".mouse-line")
        .filter(d => d.id === hoveredId)
        .attr("opacity", 1)
        .attr("stroke-width", 2.5);

    // Dim others
    d3.selectAll(".mouse-line")
        .filter(d => d.id !== hoveredId)
        .attr("opacity", 0.1);

    // Update tooltip
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

    // Button handlers
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
});