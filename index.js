import * as d3 from 'd3';
import './style.css';
import { json } from './data.js';
//import { json } from './localization.js';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import louvain from 'graphology-communities-louvain';
import { random } from 'graphology-layout';

function saneSettings(g) {
  louvain.assign(g);
  return forceAtlas2.inferSettings(g);
}

function applyLayout(g, options) {
  let settings = Object.assign({}, saneSettings(g), options),
    iterations = 100;

  // Applying a random layout before starting
  random.assign(g);

  // Applying FA2
  forceAtlas2.assign(g, { iterations: iterations, settings: settings });
}

function generatePath(d, exclude_radius) {
  var dx = d.target.x - d.source.x;
  var dy = d.target.y - d.source.y;
  var gamma = Math.atan2(dy, dx); // Math.atan2 returns the angle in the correct quadrant as opposed to Math.atan

  if (exclude_radius) {
    var sourceNewX = d.source.x + Math.cos(gamma) * d.source.r;
    var sourceNewY = d.source.y + Math.sin(gamma) * d.source.r;
    var targetNewX = d.target.x - Math.cos(gamma) * d.target.r;
    var targetNewY = d.target.y - Math.sin(gamma) * d.target.r;
  } else {
    var sourceNewX = d.source.x;
    var sourceNewY = d.source.y;
    var targetNewX = d.target.x;
    var targetNewY = d.target.y;
  }

  // Coordinates of mid point on line to add new vertex.
  let midX = (targetNewX - sourceNewX) / 2 + sourceNewX;
  let midY = (targetNewY - sourceNewY) / 2 + sourceNewY;
  return (
    'M' +
    sourceNewX +
    ',' +
    sourceNewY +
    'L' +
    midX +
    ',' +
    midY +
    'L' +
    targetNewX +
    ',' +
    targetNewY
  );
}

function ForceGraph(
  {
    nodes, // an iterable of node objects (typically [{id}, …])
    links, // an iterable of link objects (typically [{source, target}, …])
  },
  {
    containerSelector,
    nodeId = 'id', // given d in nodes, returns a unique identifier (string)
    nodeGroup, // given d in nodes, returns an (ordinal) value for color
    nodeGroups, // an array of ordinal values representing the node groups
    nodeTitle, // given d in nodes, a title string
    nodeFill = 'currentColor', // node stroke fill (if not using a group color encoding)
    nodeStroke = '#fff', // node stroke color
    nodeStrokeWidth = 1, // node stroke width, in pixels
    nodeFillOpacity = 1, // node stroke opacity
    nodeStrokeOpacity = 0.6, // node stroke opacity
    nodeRadius = 5, // node radius, in pixels
    nodeStrength,
    linkSource = ({ source }) => source, // given d in links, returns a node identifier string
    linkTarget = ({ target }) => target, // given d in links, returns a node identifier string
    linkStroke = 'black', // link stroke color
    linkStrokeOpacity = 0.6, // link stroke opacity
    linkStrokeWidth = 1.5, // given d in links, returns a stroke width in pixels
    linkStrength,
    labelFontWeight = 'normal',
    labelVisibility = 'hidden',
    labelColor = '#000000',
    colors = d3.schemeTableau10, // an array of color strings, for the node groups
    width = 640, // outer width, in pixels
    height = 400, // outer height, in pixels
    filterCriteria,
    tooltip = true,
    tooltipStyles = {
      width: 'auto',
      height: 'auto',
      padding: '10px',
      'background-color': 'white',
      'border-radius': '5px',
      border: '1px solid black',
      'z-index': 10,
    },
  } = {}
) {
  const graph = new Graph();

  nodes.forEach((n) => {
    graph.addNode(n[nodeId]);
  });
  links.forEach((e) => {
    graph.addEdge(e.source, e.target);
  });

  applyLayout(graph, {});

  const linkCnt = d3
    .rollups(
      [...links.map((d) => d.source), ...links.map((d) => d.target)],
      (v) => v.length,
      (d) => d
    )
    .map((d) => ({ [d[0]]: d[1] }))
    .reduce((previous, current) => ({ ...previous, ...current }));

  nodes.forEach((d) => {
    let n = graph.getNodeAttributes(d[nodeId]);
    d.id = d[nodeId];
    d.x = n.x;
    d.y = n.y;
    d.community = n.community;
    d.betweenness = parseFloat(d.betweenness);
    d.centrality = parseFloat(d.centrality);
    d.eigenvector = parseFloat(d.eigenvector);
    d.linkCnt = !(d['in_degree'] && d['out_degree'])
      ? linkCnt[d[nodeId]]
      : parseInt(d['in_degree']) + parseInt(d['out_degree']);
  });

  links.forEach((d) => {
    let ns = graph.getNodeAttributes(d.source);
    //let nt = graph.getNodeAttributes(d.target);
    d.community = ns.community;
    //d.source = { id: d.source, x: ns.x, y: ns.y, community: ns.community };
    //d.target = { id: d.target, x: nt.x, y: nt.y, community: nt.community };
  });

  // add tooltip to HTML body
  var tooltip = d3
    .select('#app')
    .append('div')
    .attr('class', 'tooltip')
    .style('position', 'absolute')
    .style('visibility', 'hidden');

  for (const prop in tooltipStyles) {
    tooltip.style(prop, tooltipStyles[prop]);
  }

  tooltip.select('p').html('');
  tooltip.append('a').attr('href', '').attr('target', '_blank').html('');

  if (filterCriteria) {
    nodes = nodes.filter(filterCriteria);
    const filteredNodesIDs = nodes.map((d) => d[nodeId]);
    links = links.filter(
      (d) =>
        filteredNodesIDs.indexOf(d.source.id) !== -1 &&
        filteredNodesIDs.indexOf(d.target.id) !== -1
    );
  }

  let clicked = false;
  let zoomLevel = 1;

  const linkedByIndex = {};
  links.forEach((d, i) => {
    linkedByIndex[`${d.source},${d.target}`] = 1;
  });

  const N = d3.map(nodes, (d) => d[nodeId]).map(intern);
  const LS = d3.map(links, linkSource).map(intern);
  const LT = d3.map(links, linkTarget).map(intern);
  if (nodeTitle === undefined) nodeTitle = (_, i) => N[i];
  const T = nodeTitle == null ? null : d3.map(nodes, nodeTitle);
  const G = nodeGroup == null ? null : d3.map(nodes, nodeGroup).map(intern);
  const W =
    typeof linkStrokeWidth !== 'function'
      ? null
      : d3.map(links, linkStrokeWidth);
  const L = typeof linkStroke !== 'function' ? null : d3.map(links, linkStroke);
  if (G && nodeGroups === undefined) nodeGroups = d3.sort(G);
  const color = nodeGroup == null ? null : d3.scaleOrdinal(nodeGroups, colors);

  // Replace the input nodes and links with mutable objects for the simulation.
  nodes = d3.map(nodes, (d, i) => ({ id: N[i], ...d }));
  links = d3.map(links, (_, i) => ({ source: LS[i], target: LT[i] }));

  const nodeRadiusScale = d3
    .scaleLinear()
    .domain(d3.extent(nodes, (d) => d.linkCnt))
    .range([3, 15])
    .clamp(true);

  const simulation = d3
    .forceSimulation(nodes)
    .force(
      'link',
      d3.forceLink(links).id(({ index: i }) => N[i])
    )
    .force(
      'x',
      d3.forceX((d) => d.x)
    )
    .force(
      'y',
      d3.forceY((d) => d.y)
    )
    //.force(
    //'collision',
    //d3.forceCollide().radius(function (d) {
    //return nodeRadiusScale(d.linkCnt);
    //})
    //)
    .force('charge', d3.forceManyBody().strength(-45))
    .on('tick', ticked);

  var dropdown = document.getElementById('dropdown');
  var slider = document.getElementById('slider');
  var output = document.getElementById('slider-value');
  output.innerHTML = slider.value; // Display the default slider value

  // Update the current slider value (each time you drag the slider handle)
  slider.oninput = function () {
    let value = this.value / 1000;
    if (dropdown.value === 'centrality') value = this.value;
    output.innerHTML = value;
    filterGraph(dropdown.value, value);
  };

  dropdown.onchange = function () {
    filterGraph(this.value, slider.value);
  };

  const showEle = showFiltered(nodes, links, dropdown.value, slider.value);

  const svg = d3
    .select(containerSelector)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [-width / 2, -height / 2, width, height])
    .attr('style', 'max-width: 100%; height: auto; pointer-events: auto;');

  const g = svg.append('g');

  const link = g
    .append('g')
    .attr('class', 'link')
    .selectAll('path')
    .data(links)
    .join('path')
    .attr('stroke', typeof linkStroke !== 'function' ? linkStroke : null)
    .attr(
      'stroke-width',
      typeof linkStrokeWidth !== 'function' ? linkStrokeWidth : null
    )
    .attr('stroke-opacity', (d) =>
      showEle.links.map((el) => el.source.id).indexOf(d.source.id) !== -1 &&
      showEle.links.map((el) => el.target.id).indexOf(d.target.id) !== -1
        ? linkStrokeOpacity
        : 0
    )
    .attr('d', (d) => generatePath(d));

  const node = g
    .append('g')
    .selectAll('.node')
    .data(nodes)
    .join('g')
    .attr('class', 'node')
    .attr('pointer-events', 'auto')
    .attr('cursor', 'pointer')
    .attr('opacity', (d) => (showEle.nodes.indexOf(d.id) !== -1 ? 1 : 0))
    .attr('transform', (d) => `translate(${d.x}, ${d.y})`)
    .call(drag(simulation))
    .on('click', function (event, dd) {
      event.preventDefault();
      clicked = !clicked;
      if (clicked) {
        svg.selectAll('.node').attr('opacity', function (o) {
          return isConnected(dd, o) ? 1 : 0;
        });

        svg.selectAll('path').attr('stroke-opacity', function (o) {
          return o.source.id === dd.id || o.target.id === dd.id
            ? linkStrokeOpacity
            : 0;
        });

        svg
          .selectAll('.label')
          .filter((d) => isConnected(dd, d) || d.id === dd.id)
          .attr('visibility', 'visible');

        svg
          .selectAll('.label')
          .filter((d) => !(isConnected(dd, d) || d.id === dd.id))
          .attr('visibility', 'hidden');

        tooltip
          .style('top', event.pageY - 10 + 'px')
          .style('left', event.pageX + 10 + 'px')
          .style('visibility', 'visible');

        tooltip.select('p').html(dd.id);
        tooltip.select('a').attr('href', dd.profile).html(dd.profile);
      } else {
        svg
          .selectAll('.node')
          .attr('opacity', (d) => (showEle.nodes.indexOf(d.id) !== -1 ? 1 : 0));

        svg
          .selectAll('path')
          .attr('stroke-opacity', (d) =>
            showEle.links.map((el) => el.source.id).indexOf(d.source.id) !==
              -1 &&
            showEle.links.map((el) => el.target.id).indexOf(d.target.id) !== -1
              ? linkStrokeOpacity
              : 0
          );

        svg.selectAll('.label').attr('visibility', labelVisibility);
        tooltip
          .style('top', event.pageY - 10 + 'px')
          .style('left', event.pageX + 10 + 'px')
          .style('visibility', 'hidden');
      }
    })
    .on('mouseover', function (event, dd) {
      if (clicked) return;
      event.preventDefault();
      svg
        .selectAll('.label')
        .filter((d) => d.id == dd.id)
        .attr('visibility', 'visible');
    })
    .on('mouseleave', function (event, dd) {
      if (clicked) return;
      svg.selectAll('.label').attr('visibility', labelVisibility);
    });

  node
    .append('circle')
    //.attr('r', nodeRadius)
    .attr('fill', nodeFill)
    .attr('stroke', nodeStroke)
    .attr('r', (d) => nodeRadiusScale(d.linkCnt))
    .attr('fill-opacity', nodeFillOpacity)
    .attr('stroke-opacity', nodeStrokeOpacity)
    .attr('stroke-width', nodeStrokeWidth);

  if (W) link.attr('stroke-width', (d, i) => W[i]);
  if (L) link.attr('stroke', (d, i) => L[i]);
  if (G)
    node
      .select('circle')
      .attr('fill', (d, i) => color(G[i]))
      .attr('stroke', (d, i) => color(G[i]));

  if (T) {
    node
      .append('text')
      .attr('class', 'label')
      .attr('x', (d) => nodeRadiusScale(d.linkCnt) + 3)
      .attr('dominant-baseline', 'middle')
      .attr('text-anchor', 'start')
      .attr('fill', labelColor)
      .attr('font-size', (d) => Math.max(7, nodeRadiusScale(d.linkCnt)))
      .attr('font-weight', labelFontWeight)
      .attr('visibility', labelVisibility)
      .text((d, i) => T[i]);
  }

  //add zoom capabilities
  let zoomHandler = d3.zoom().on('zoom', function (event) {
    g.attr('transform', event.transform);
    if (clicked) return;
    zoomLevel = event.transform.k;
    if (zoomLevel >= 2.5) {
      svg
        .selectAll('.label')
        .attr('visibility', (d) => (d.linkCnt >= 3 ? 'visible' : 'hidden'));
    } else if (zoomLevel >= 1.8) {
      svg
        .selectAll('.label')
        .attr('visibility', (d) => (d.linkCnt >= 9 ? 'visible' : 'hidden'));
    }
  });

  svg.call(zoomHandler);

  function intern(value) {
    return value !== null && typeof value === 'object'
      ? value.valueOf()
      : value;
  }

  function isConnected(a, b) {
    return (
      linkedByIndex[`${a.id},${b.id}`] ||
      linkedByIndex[`${b.id},${a.id}`] ||
      a.id === b.id
    );
  }

  function showFiltered(nodes, links, criteria, value, strict = true) {
    const showNodesIDs = nodes
      .filter((d) => d[criteria] >= value)
      .map((d) => d[nodeId]);

    if (strict) {
      const linksShow = links.filter(
        (d) =>
          showNodesIDs.indexOf(d.source.id) !== -1 &&
          showNodesIDs.indexOf(d.target.id) !== -1
      );

      return { nodes: showNodesIDs, links: linksShow };
    } else {
      const linksShow = links.filter(
        (d) =>
          showNodesIDs.indexOf(d.source.id) !== -1 ||
          showNodesIDs.indexOf(d.target.id) !== -1
      );
      const nodesShow = linksShow
        .map((d) => d.source.id)
        .concat(linksShow.map((d) => d.target.id));
      return { nodes: nodesShow, links: linksShow };
    }
  }

  function filterGraph(attribute, threshold) {
    const showEle = showFiltered(nodes, links, attribute, threshold);
    svg
      .selectAll('.node')
      .attr('opacity', (d) => (showEle.nodes.indexOf(d.id) !== -1 ? 1 : 0));

    svg.selectAll('path').attr('stroke-opacity', (d) => {
      return showEle.links.map((el) => el.source.id).indexOf(d.source.id) !==
        -1 &&
        showEle.links.map((el) => el.target.id).indexOf(d.target.id) !== -1
        ? linkStrokeOpacity
        : 0;
    });
  }

  function ticked() {
    link.attr('d', (d) => generatePath(d));
    node.attr('transform', (d) => `translate(${d.x}, ${d.y})`);
  }

  function drag(simulation) {
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    return d3
      .drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended);
  }
}

let colors = d3.schemeCategory10
  .concat()
  .reverse()
  .concat('DodgerBlue', 'lime', 'tomato');
colors[2] = 'orange';

// Execute the function to generate a new network
ForceGraph(
  { nodes: json.nodes, links: json.links },
  {
    containerSelector: '#app',
    nodeId: 'id',
    nodeGroup: (d) => d.community,
    nodeTitle: (d) => d.id,
    linkStrokeWidth: 0.8,
    linkStrokeOpacity: 0.4,
    linkStroke: (d) => colors[d.community],
    labelFontWeight: (d) => (d.linkCnt >= 20 ? 'bold' : 'normal'),
    labelVisibility: (d) => (d.linkCnt >= 20 ? 'visible' : 'hidden'),
    colors,
    width: window.innerWidth,
    height: window.innerHeight,
    //filterCriteria: d => d["eigenvector centrality"] > 0.01,
    //filterCriteria: d => d["betweenness"] > 0.01
  }
);
