import React, { Component } from 'react';
import './App.css';
import * as moment from "moment";
import Viva from 'vivagraphjs';
import * as centrality from 'ngraph.centrality';
import snap_fb from './data/snap_fb.json';
import amherst from './data/amherst.json';
import { saveAs } from 'file-saver';
import { Divider, Form, Input, Grid, Dropdown, Header, Button, Popup, Icon, TextArea } from 'semantic-ui-react';
import {
  XYPlot,
  XAxis,
  YAxis,
  VerticalGridLines,
  HorizontalGridLines,
  VerticalRectSeries,
  Highlight
} from 'react-vis';

const SIZE_CUTOFF = 1000

class Network extends Component {

  state = {
    isRendering: true,
    nodeOptions: [],
    attrOptions: [],
    selectedNodes: new Set([]),
    colorBy: null,
    springLength: 10,
    springCoeff: 0.0005,
    dragCoeff: 0.02,
    theta: 0.8,
    gravity: -1.2,
    timeStep: 20,
    randomWalkStep: 2,
    linkTransparency: 0.3,
    degreeArea: null,
    betweennessArea: null,
    betweennessEnabled: false,
  }

  loadGraph = data => {
    if (!data) {
      return;
    }

    if (this.renderer) {
      this.renderer.dispose();
    }

    this.originalGraph = Viva.Graph.graph();
    this.graph = Viva.Graph.graph();
    this.includedNodes = new Set([]);
    this.setState({
      selectedNodes: new Set([]),
      colorBy: null,
    });

    const nodeOptions = []
    this.graphNumNodes = data.nodes.length
    data.nodes.forEach(n => { this.originalGraph.addNode(String(n.id), n); })
    data.edges.forEach(e => { this.originalGraph.addLink(String(e.source), String(e.target)); })
    this.originalGraph.forEachNode(node => {
      const sid = String(node.id)
      this.graph.addNode(sid, node.data);
      this.includedNodes.add(sid);
      nodeOptions.push({key: sid, value: sid, text: sid})
    });
    this.originalGraph.forEachLink(link => {
      this.graph.addLink(link.fromId, link.toId);
    });
    this.preComputeOriginalGraph();
    this.setState({
      nodeOptions: nodeOptions,
      attrOptions: Object.keys(data.nodes[0]).map(k => ({
        key: k,
        value: k,
        text: k,
      })),
    })

    // Set custom nodes appearance
    this.graphics = Viva.Graph.View.webglGraphics();

    this.layout = Viva.Graph.Layout.forceDirected(this.graph, {
      springLength: this.state.springLength,
      springCoeff: this.state.springCoeff,
      dragCoeff: this.state.dragCoeff,
      gravity: this.state.gravity
    });

    this.events = Viva.Graph.webglInputEvents(this.graphics, this.graph);
    this.events.click(node => {
      this.selectANode(node.id);
    });

    this.renderer = Viva.Graph.View.renderer(this.graph, {
      graphics: this.graphics,
      container: document.getElementById('graph-container'),
      layout: this.layout,
    });
    this.renderer.run();
    this.setLinkTransparency(this.state.linkTransparency);

    this.renderMatrix();
    this.recolor();
  }

  renderMatrix = () => {
    if(this.matrixRenderer) {
      this.matrixRenderer.dispose();
    }
    this.matrix = Viva.Graph.graph();
    this.matrixGraphics = Viva.Graph.View.webglGraphics();
    this.matrixLayout = Viva.Graph.Layout.constant(this.matrix);
    this.matrixRenderer = Viva.Graph.View.renderer(this.matrix, {
      graphics: this.matrixGraphics,
      container: document.getElementById('matrix-container'),
      layout: this.matrixLayout,
      interactive: 'drag scroll',
    });
    var i = 0;

    this.matrixNodePositions = {};
    this.graph.forEachLink(link => {
      this.matrix.addNode(i);
      this.matrixNodePositions[i] = { x: link.fromId * 10 - 400, y: link.toId * 10 - 400 };
      i++;
      this.matrix.addNode(i);
      this.matrixNodePositions[i] = { x: link.toId * 10 - 400, y: link.fromId * 10 - 400 };
      i++;
    })
    this.matrixLayout.placeNode(node => this.matrixNodePositions[node.id]);

    this.events = Viva.Graph.webglInputEvents(this.matrixGraphics, this.matrix);
    this.events.click(node => {
      var position = this.matrixLayout.getNodePosition(node.id);
      var [x, y] = this.getXYfromMatrix(position)
      this.forceAddANode(x)
      this.forceAddANode(y)
      if (this.graphNumNodes <= SIZE_CUTOFF) {
        this.recolor()
      }
    });

    this.matrixRenderer.run();
  }

  selectANode = id => {
    if (this.state.selectedNodes.has(id)) {
      const newSelectedNodes = new Set(this.state.selectedNodes);
      newSelectedNodes.delete(id);
      this.setState({ selectedNodes: newSelectedNodes });
      if (this.graphNumNodes > SIZE_CUTOFF) {
        this.recolorOneNode(this.graph.getNode(id), this.graphics.getNodeUI(id), false)
      }
    } else {
      this.setState({ selectedNodes: new Set(this.state.selectedNodes).add(id) });
      if (this.graphNumNodes > SIZE_CUTOFF) {
        this.recolorOneNode(this.graph.getNode(id), this.graphics.getNodeUI(id), true)
      }
    }
    this.renderer.rerender()
    if (this.graphNumNodes <= SIZE_CUTOFF) {
      this.recolor()
    }
  }

  preComputeOriginalGraph = () => {
    this.preComputeOriginalGraphNodeDegree();
    if (this.state.betweennessEnabled) {
      this.preComputeOriginalGraphNodeBetweenness();
    }
  }

  preComputeOriginalGraphNodeDegree = () => {
    this.originalGraphNodeDegree = centrality.degree(this.originalGraph);
    this.originalGraphDegreeDist = {}
    this.originalGraph.forEachNode(node => {
      const degree = this.originalGraphNodeDegree[node.id];
      if (!(degree in this.originalGraphDegreeDist)) {
        this.originalGraphDegreeDist[degree] = 0;
      }
      this.originalGraphDegreeDist[degree]++;
    })
  }

  preComputeOriginalGraphNodeBetweenness = () => {
    this.originalGraphNodeBetweenness = centrality.betweenness(this.originalGraph);
    this.originalGraphBetweennessDist = {}
    this.originalGraph.forEachNode(node => {
      const betweenness = this.originalGraphNodeBetweenness[node.id];
      if (!(betweenness in this.originalGraphBetweennessDist)) {
        this.originalGraphBetweennessDist[betweenness] = 0;
      }
      this.originalGraphBetweennessDist[betweenness]++;
    })
  }

  componentDidMount() {
    // Construct the graph

    document.addEventListener('keydown', e => {
      if (e.which === 16) { // shift key
        this.renderer && this.renderer.pause();
        this.setState({ isRendering: false })

        if (!this.multiSelectOverlay) {
          var domOverlay = document.querySelector('#graph-overlay');
          this.multiSelectOverlay = this.createOverlay(domOverlay);
        }
      }
    });
    document.addEventListener('keyup', e => {
      if (e.which === 16) {
        if (this.multiSelectOverlay) {
          this.multiSelectOverlay.destroy();
          this.multiSelectOverlay = null;
        }
      }
    });
  }

  createOverlay = (overlayDom) => {
    var selectionClasName = 'graph-selection-indicator';
    var selectionIndicator = overlayDom.querySelector('#' + selectionClasName);
    if (!selectionIndicator) {
      selectionIndicator = document.createElement('div');
      selectionIndicator.id = selectionClasName;
      overlayDom.appendChild(selectionIndicator);
    }

    var dragndrop = Viva.Graph.Utils.dragndrop(overlayDom);
    var selectedArea = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
    var startX = 0;
    var startY = 0;
    var currentSelectedNodes = new Set([])

    dragndrop.onStart(e => {
      var rect = e.target.getBoundingClientRect();
      var x = Math.floor(e.clientX - rect.left); //x position within the element.
      var y = Math.floor(e.clientY - rect.top);  //y position within the element.
      startX = selectedArea.x = x;
      startY = selectedArea.y = y;
      selectedArea.width = selectedArea.height = 0;

      updateSelectedAreaIndicator();
      selectionIndicator.style.display = 'block';
    });

    dragndrop.onDrag(e => {
      recalculateSelectedArea(e);
      updateSelectedAreaIndicator();

      var area = selectedArea;
      var topLeft = this.graphics.transformClientToGraphCoordinates({
        x: area.x,
        y: area.y
      });

      var bottomRight = this.graphics.transformClientToGraphCoordinates({
        x: area.x + area.width,
        y: area.y + area.height
      });

      this.graph.forEachNode(node => {
        var nodePos = this.layout.getNodePosition(node.id);
        if (topLeft.x < nodePos.x && nodePos.x < bottomRight.x &&
          topLeft.y < nodePos.y && nodePos.y < bottomRight.y) {
          currentSelectedNodes.add(node.id);
          if (this.graphNumNodes > SIZE_CUTOFF) {
            this.recolorOneNode(node, this.graphics.getNodeUI(node.id), true)
          }
        } else {
          if (currentSelectedNodes.has(node.id)) {
            currentSelectedNodes.delete(node.id);
            if (this.graphNumNodes > SIZE_CUTOFF) {
              this.recolorOneNode(node, this.graphics.getNodeUI(node.id), this.state.selectedNodes.has(node.id))
            }
          }
        }
      });
      this.renderer.rerender()
      if (this.graphNumNodes <= SIZE_CUTOFF) {
        this.recolor(currentSelectedNodes)
      }
    });

    dragndrop.onStop(() => {
      selectionIndicator.style.display = 'none';
      this.setState({ selectedNodes: new Set([...this.state.selectedNodes, ...currentSelectedNodes]) });
      currentSelectedNodes = new Set([]);
    });

    overlayDom.style.display = 'block';

    return {
      destroy: function () {
        overlayDom.style.display = 'none';
        selectionIndicator.style.width = '0';
        selectionIndicator.style.height = '0';
        dragndrop.release();
      }
    };


    function recalculateSelectedArea(e) {
      var rect = e.target.getBoundingClientRect();
      var x = Math.floor(e.clientX - rect.left); //x position within the element.
      var y = Math.floor(e.clientY - rect.top);  //y position within the element.
      if (x > 10 && y > 10) {
        selectedArea.width = Math.abs(x - startX);
        selectedArea.height = Math.abs(y - startY);
        selectedArea.x = Math.min(x, startX);
        selectedArea.y = Math.min(y, startY);
      }
    }

    function updateSelectedAreaIndicator() {
      selectionIndicator.style.left = selectedArea.x + 'px';
      selectionIndicator.style.top = selectedArea.y + 'px';
      selectionIndicator.style.width = selectedArea.width + 'px';
      selectionIndicator.style.height = selectedArea.height + 'px';
    }
  }

  click = () => {
    if (this.state.isRendering) {
      this.renderer.pause();
    } else {
      this.renderer.resume();
    }
    this.setState({ isRendering: !this.state.isRendering })
  }

  changeSpringLength = e => {
    this.layout.simulator.springLength(e.target.value);
    this.setState({ springLength: e.target.value });
  }

  changeSpringCoeff = e => {
    this.layout.simulator.springCoeff(e.target.value);
    this.setState({ springCoeff: e.target.value });
  }

  changeGravity = e => {
    this.layout.simulator.gravity(e.target.value);
    this.setState({ gravity: e.target.value });
  }

  changeTheta = e => {
    this.layout.simulator.theta(e.target.value);
    this.setState({ theta: e.target.value });
  }

  changeDragCoeff = e => {
    this.layout.simulator.dragCoeff(e.target.value);
    this.setState({ dragCoeff: e.target.value });
  }

  changeTimeStep = e => {
    this.layout.simulator.timeStep(e.target.value);
    this.setState({ timeStep: e.target.value });
  }

  decimalToHex = (d, padding) => {
    var hex = Number(d).toString(16);
    padding = typeof (padding) === "undefined" || padding === null ? padding = 2 : padding;

    while (hex.length < padding) {
      hex = "0" + hex;
    }

    return hex;
  }

  setLinkTransparency = alpha => {
    const colorHex = '000000' + this.decimalToHex(parseInt(alpha * 255), 2)
    const color = parseInt(colorHex, 16);
    this.setState({ linkTransparency: alpha })
    this.graph.forEachLink(link => {
      const linkUI = this.graphics.getLinkUI(link.id);
      linkUI.color = color
    })
    this.renderer.rerender();
  }

  newGraphFromSelectedNodes = () => {
    var out = { nodes: [], edges: [] }
    var selectedNodesStringSet = new Set([])
    this.state.selectedNodes.forEach(nid => {
      out.nodes.push({ id: nid });
      selectedNodesStringSet.add(String(nid))
    });
    this.originalGraph.forEachLink(link => {
      if (selectedNodesStringSet.has(String(link.fromId)) && selectedNodesStringSet.has(String(link.toId))) {
        out.edges.push({ source: link.fromId, target: link.toId });
      }
    });
    this.loadGraph(out);
  }

  recolorOneNode = (node, nodeUI, isSelected) => {
    if (isSelected) {
      nodeUI.color = 0xFFA500ff;
    } else {
      var alpha = this.state.colorBy ? node.data[this.state.colorBy] : 1;
      const colorHex = '009ee8' + this.decimalToHex(parseInt(alpha * 255), 2)
      const color = parseInt(colorHex, 16);
      nodeUI.color = color;
    }
  }

  getXYfromMatrix = position => {
     return [String((position.x + 400) / 10), String((position.y + 400) / 10)]
  }

  recolor = (currentSelectedNodes = new Set()) => {
    const checkNode = id => this.state.selectedNodes.has(id) || currentSelectedNodes.has(id)
    this.graph.forEachNode(node => {
      this.recolorOneNode(node, this.graphics.getNodeUI(node.id), checkNode(node.id))
    })

    this.matrix.forEachNode(node => {
      var position = this.matrixLayout.getNodePosition(node.id);
      var [x, y] = this.getXYfromMatrix(position)
      var nodeUI = this.matrixGraphics.getNodeUI(node.id)
      if (checkNode(x) && checkNode(y)) {
        nodeUI.color = 0xFFA500ff;
      } else {
        nodeUI.color = 0x009ee8ff;
      }
    })
    this.matrixRenderer.rerender();
    this.renderer.rerender();
  }

  clearSelectedNodes = async () => {
    if (this.graphNumNodes > SIZE_CUTOFF) {
      for (var id in this.state.selectedNodes) {
        this.recolorOneNode(this.graph.getNode(id), this.graphics.getNodeUI(id), false)
      }
    }
    await this.setState({ selectedNodes: new Set([]) });
    if (this.graphNumNodes <= SIZE_CUTOFF) {
      this.recolor()
    }
    this.renderer.rerender()
  }

  resetLinks = _ => {
    this.originalGraph.forEachLink(link => {
      if (this.includedNodes.has(String(link.fromId)) && this.includedNodes.has(String(link.toId))) {
        this.graph.addLink(link.fromId, link.toId);
      }
    })
  }

  exportJson = () => {
    var out = {nodes: [], edges: []}
    this.graph.forEachNode(node => {
      out.nodes.push({id: node.id});
    });
    this.graph.forEachLink(link => {
      out.edges.push({source: link.fromId, target: link.toId});
    });
    return JSON.stringify(out);
  }

  changeColorBy = async (e, d) => {
    await this.setState({ colorBy: d.value });
    this.recolor();
  }

  resetColorBy = async () => {
    await this.setState({ colorBy: null });
    this.recolor();
  }

  changeRandomWalkFrom = (e, d) => {
    this.setState({ randomWalkFrom: d.value });
  }

  changeRandomWalkStep = e => {
    this.setState({ randomWalkStep: e.target.value });
  }

  forceAddANode = async id => {
    await this.setState({ selectedNodes: new Set(this.state.selectedNodes).add(id) });
    this.recolorOneNode(this.graph.getNode(id), this.graphics.getNodeUI(id), true)
    this.renderer.rerender()
  }

  doRandomWalk = async () => {
    var currentId = this.state.randomWalkFrom;
    for (let i = 0; i < this.state.randomWalkStep; i++) {
      await this.forceAddANode(currentId);
      var candidates = []
      this.graph.forEachLinkedNode(currentId, (linkedNode, link) => {
        candidates.push(link.toId)
      })
      currentId = candidates[Math.floor(Math.random() * candidates.length)];
    }
  }

  doFilter = () => {
    this.includedNodes = new Set([]);
    this.setState({ selectedNodes: new Set([]) });
    this.graph.forEachNode(node => {
      this.graph.removeNode(node.id)
    })
    this.originalGraph.forEachNode(node => {
      const degree = this.originalGraphNodeDegree[node.id];
      var isIn = true;
      if (this.state.degreeArea && (degree < this.state.degreeArea.left || this.state.degreeArea.right < degree)) {
        isIn = false
      }
      if (this.state.betweennessEnabled) {
        const betweenness = this.originalGraphNodeBetweenness[node.id];
        if (this.state.betweennessArea && (
          betweenness < this.state.betweennessArea.left || this.state.betweennessArea.right < betweenness
        )) {
          isIn = false;
        }
      }
      var sid = String(node.id)
      if (isIn) {
        this.includedNodes.add(sid);
        this.graph.addNode(sid);
      }
    });
    this.resetLinks();
    this.recolor();
  }

  degreeBrush = async (area) => {
    await this.setState({ degreeArea: area });
    this.doFilter();
  }

  betweennessBrush = async (area) => {
    await this.setState({ betweennessArea: area });
    this.doFilter();
  }

  makeHist = (dist, lastArea, brushFn) => {
    var data = [];
    for (var val in dist) {
      val = parseFloat(val)
      data.push({ x0: val, x: val + 1, y: dist[val] })
    }
    const hist =
      <XYPlot
        width={300}
        height={200}
        xDomain={
          lastArea && [
            lastArea.left,
            lastArea.right
          ]
        }
      >
        <VerticalGridLines />
        <HorizontalGridLines />
        <XAxis tickLabelAngle={-60}/>
        <YAxis />
        <VerticalRectSeries data={data} />
        <Highlight
          drag={false}
          enableY={false}
          onBrushEnd={brushFn} />
      </XYPlot>
    return hist;
  }

  enableBetweenness = () => {
    this.preComputeOriginalGraphNodeBetweenness();
    this.setState({ betweennessEnabled: true });
  }

  updateInput = e => {
    try {
      let parsed = JSON.parse(e.target.value);
      this.setState({ userData: parsed });
    } catch (e) {
      return;
    }
  }

  render() {
    const SelectedNodesList = () => (
      <div>
        {Array.from(this.state.selectedNodes)
              .map(id => {
                var ct = String(id)
                if (this.state.colorBy) {
                  ct = ct + " (" + this.state.colorBy + "=" + this.graph.getNode(id).data[this.state.colorBy] + ")"
                }
                return (
                  <div>{ct}</div>
                )
              })
        }
      </div>
    )

    const degreeHist = this.makeHist(this.originalGraphDegreeDist, this.state.degreeArea, this.degreeBrush);
    const betweennessHist = this.state.betweennessEnabled ? this.makeHist(this.originalGraphBetweennessDist, this.state.betweennessArea, this.betweennessBrush) : <Button size='mini' onClick={this.enableBetweenness}>Enable</Button>;

    return (
      <Grid>
        <Grid.Row>
          <Grid.Column width={4} className={"sideDiv"}>
            <h2>Control Panel</h2>
            <Grid>
              <Grid.Column width={4}>
                <Button size='mini' onClick={() => { this.loadGraph(snap_fb); }}>SNAP</Button>
              </Grid.Column>
              <Grid.Column width={4}>
                <Button size='mini' onClick={() => { this.loadGraph(amherst); }}>AMHERST</Button>
              </Grid.Column>
              <Grid.Column width={4}>
                <Popup
                  trigger={
                    <Button size='mini' color='red' content='Custom' />
                  }
                  content={<Form>
                    <TextArea placeholder='{"nodes": [{"id":"1"},{"id":"2"}], "edges": [{"id":"0","source":"1","target":"2"}]}' onChange={this.updateInput} />
                    <div style={{ height: '5px' }} />
                    <Button size='mini' color='green' content='Confirm' onClick={() => { this.loadGraph(this.state.userData); }} /></Form>}
                  on='click'
                  position='top right'
                />
              </Grid.Column>
              <Grid.Column width={4}>
                <Button size='mini' onClick={() => {
                  var blob = new Blob([this.exportJson()], { type: "text/plain;charset=utf-8" });
                  saveAs(blob, `network_data_${moment().format("YYMMDDhhmmss")}.json`);
                }}
                >Export</Button>
              </Grid.Column>
            </Grid>

            <Divider/>

            <Grid>
              <Grid.Column width={10}>
                <Dropdown fluid search selection options={this.state.attrOptions} onChange={this.changeColorBy} placeholder="color by"/>
              </Grid.Column>
              <Grid.Column width={6}>
                <Button onClick={this.resetColorBy}>Reset color</Button>
              </Grid.Column>
            </Grid>

            <Divider/>

            <div>
              <Header as='h3'><Popup
                trigger={<Icon name='question circle' size='mini' />}
                content="Select by clicking on a node or shift-drag on a graph or by enter nodeFrom below (if step is more than 1, it will perform a random walk from nodeFrom)"
                basic
                size="mini"
              />Node selection</Header>

              <Grid>
                <Grid.Column width={5}>
                  <Input fluid label='Step' defaultValue="1" onChange={this.changeRandomWalkStep} />
                </Grid.Column>
                <Grid.Column width={5}>
                  <Dropdown fluid search selection options={this.state.nodeOptions} onChange={this.changeRandomWalkFrom} placeholder="nodeFrom"/>
                </Grid.Column>
                <Grid.Column width={5}>
                  <Button onClick={this.doRandomWalk}>Select</Button>
                </Grid.Column>
              </Grid>
              <Header as='h4'>Selected Nodes:</Header>
              <SelectedNodesList />
              <Grid>
                <Grid.Column width={5}>
                  <Button size='mini' onClick={this.clearSelectedNodes}>Clear</Button>
                </Grid.Column>
                <Grid.Column width={5}>
                  <Button size='mini' onClick={() => this.recolor()}>Refresh matrix</Button>
                </Grid.Column>
                <Grid.Column width={5}>
                  <Button size='mini' onClick={this.newGraphFromSelectedNodes}>Render</Button>
                </Grid.Column>
              </Grid>
            </div>

            <Divider/>

            <div>
              <Header as='h3'><Popup
                trigger={<Icon name='question circle' size='mini' />}
                content="Drag to draw an area on the histogram to filter. Click on it to reset."
                basic
                size="mini"
              />Degree filtering</Header>
              {degreeHist}
              <Header as='h3'><Popup
                trigger={<Icon name='question circle' size='mini' />}
                content="Calculating betweenness takes O(V*E) time. It is disabled by default."
                basic
                size="mini"
              />Betweenness filtering</Header>
              {betweennessHist}
            </div>

            <Divider/>

            <div>

              {
                this.state.isRendering ?
                  <button className="ui icon left labeled button" onClick={this.click}><i aria-hidden="true" className="pause icon"></i>Pause layout</button> :
                <button className="ui icon left labeled button" onClick={this.click}><i aria-hidden="true" className="play icon"></i>Resume layout</button>
              }

              <Header as='h3'>Force Layout Parameters</Header>
              <Grid>
                <Grid.Row>
                  <Grid.Column width={5} textAlign='right'><Popup
                    trigger={<Icon name='question circle' />}
                    content="Hook's law coefficient. The smaller number loosens edges length."
                    basic
                  /> Spring Length</Grid.Column>
                  <Grid.Column width={8}><input type="range" defaultValue="10" onChange={this.changeSpringLength} /></Grid.Column>
                  <Grid.Column width={3}>{this.state.springLength}</Grid.Column>
                </Grid.Row>
                <Grid.Row>
                  <Grid.Column width={5} textAlign='right'><Popup
                    trigger={<Icon name='question circle' />}
                    content="Ideal length of edges in pixels."
                    basic
                  /> Spring Coeff</Grid.Column>
                  <Grid.Column width={8}><input type="range" defaultValue="0.0005" min="0" max="0.2" step="0.0005" onChange={this.changeSpringCoeff} /></Grid.Column>
                  <Grid.Column width={3}>{this.state.springCoeff}</Grid.Column>
                </Grid.Row>
                <Grid.Row>
                  <Grid.Column width={5} textAlign='right'><Popup
                    trigger={<Icon name='question circle' />}
                    content="Coulomb's law coefficient. The smaller number makes repelling force stronger. Making it positive makes node attract each other."
                    basic
                  /> Gravity</Grid.Column>
                  <Grid.Column width={8}><input type="range" defaultValue="-1.2" min="-10" max="2" step="0.1" onChange={this.changeGravity} /></Grid.Column>
                  <Grid.Column width={3}>{this.state.gravity}</Grid.Column>
                </Grid.Row>
                <Grid.Row>
                  <Grid.Column width={5} textAlign='right'><Popup
                    trigger={<Icon name='question circle' />}
                    content="Barnes-Hut simulation coefficient. Values larger than 1 will make system converge faster but not necessary to the best layout."
                    basic
                  /> Theta</Grid.Column>
                  <Grid.Column width={8}><input type="range" defaultValue="0.8" min="0" max="1.5" step="0.01" onChange={this.changeTheta} /></Grid.Column>
                  <Grid.Column width={3}>{this.state.theta}</Grid.Column>
                </Grid.Row>
                <Grid.Row>
                  <Grid.Column width={5} textAlign='right'><Popup
                    trigger={<Icon name='question circle' />}
                    content="System cooldown coefficient. The larger it is the faster system will stop."
                    basic
                  /> Drag Coeff</Grid.Column>
                  <Grid.Column width={8}><input type="range" defaultValue="0.02" min="0" max="1" step="0.01" onChange={this.changeDragCoeff} /></Grid.Column>
                  <Grid.Column width={3}>{this.state.dragCoeff}</Grid.Column>
                </Grid.Row>
                <Grid.Row>
                  <Grid.Column width={5} textAlign='right'><Popup
                    trigger={<Icon name='question circle' />}
                    content="Time step of each iteration for the renderer."
                    basic
                  /> Time Step</Grid.Column>
                  <Grid.Column width={8}><input type="range" defaultValue="20" min="5" max="50" step="5" onChange={this.changeTimeStep} /></Grid.Column>
                  <Grid.Column width={3}>{this.state.timeStep}</Grid.Column>
                </Grid.Row>
                <Grid.Row>
                  <Grid.Column width={5} textAlign='right'><Popup
                    trigger={<Icon name='question circle' />}
                    content="Alpha value of the links."
                    basic
                  /> Link Transparency</Grid.Column>
                  <Grid.Column width={8}><input type="range" defaultValue="0.3" min="0" max="1" step="0.1" onChange={e => this.setLinkTransparency(parseFloat(e.target.value))} /></Grid.Column>
                  <Grid.Column width={3}>{this.state.linkTransparency}</Grid.Column>
                </Grid.Row>
              </Grid>
            </div>

            <Divider/>

            <div>Scroll on the graph to zoom in/zoom out</div>
          </Grid.Column>

          <Grid.Column width={8}>
            <h2>Force Layout</h2>
            <div id="graph-div">
              <div id="graph-container" />
              <div id="graph-overlay" />
            </div>
          </Grid.Column>

          <Grid.Column width={4}>
            <h2>Matrix Layout</h2>
            <div id="matrix-div">
              <div id="matrix-container" />
              <div id="matrix-overlay" />
            </div>
          </Grid.Column>
        </Grid.Row>
      </Grid>
    );
  }
}

class App extends Component {

  render() {
    return (
      <div className="App">
        <Network />
      </div>
    );
  }
}

export default App;
