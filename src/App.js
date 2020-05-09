import React, { Component } from 'react';
import './App.css';
import * as moment from "moment";
import Viva from 'vivagraphjs';
import * as centrality from 'ngraph.centrality';
import snap_fb from './data/snap_fb.json';
import { saveAs } from 'file-saver';
import { Form, Grid, Header, Button, List, Segment, Popup, Icon, TextArea } from 'semantic-ui-react';
import {
  XYPlot,
  XAxis,
  YAxis,
  VerticalGridLines,
  HorizontalGridLines,
  VerticalRectSeries,
  Highlight
} from 'react-vis';

class Network extends Component {

  state = {
    isRendering: true,
    selectedNodes: new Set([]),
    matrixSelectedNodes: new Set([]),
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
    this.setState({ selectedNodes: new Set([]) });

    data.nodes.forEach(n => { this.originalGraph.addNode(n.id); })
    data.edges.forEach(e => { this.originalGraph.addLink(e.source, e.target); })
    this.originalGraph.forEachNode(node => {
      this.graph.addNode(node.id);
      this.includedNodes.add(String(node.id));
    });
    this.originalGraph.forEachLink(link => {
      this.graph.addLink(link.fromId, link.toId);
    });
    this.preComputeOriginalGraph();

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
      // console.log('Single click on node: ' + node.id);
      var nodeUI = this.matrixGraphics.getNodeUI(node.id);
      if (this.state.matrixSelectedNodes.has(node.id)) {
        const newMatrixSelectedNodes = new Set(this.state.matrixSelectedNodes);
        newMatrixSelectedNodes.delete(node.id);
        this.setState({ matrixSelectedNodes: newMatrixSelectedNodes });
        nodeUI.color = 0x009ee8ff;
        nodeUI.size = 10;
      } else {
        this.setState({ matrixSelectedNodes: new Set(this.state.matrixSelectedNodes).add(node.id) });
        nodeUI.color = 0xFFA500ff;
        nodeUI.size = 15;
      }
      this.matrixRenderer.rerender();
      var position = this.matrixLayout.getNodePosition(node.id);
      this.selectANode((position.x + 400) / 10);
      this.selectANode((position.y + 400) / 10);
    });

    this.matrixRenderer.run();
  }

  selectANode = id => {
    var nodeUI = this.graphics.getNodeUI(id);
    if (this.state.selectedNodes.has(id)) {
      const newSelectedNodes = new Set(this.state.selectedNodes);
      newSelectedNodes.delete(id);
      this.setState({ selectedNodes: newSelectedNodes });
      nodeUI.color = 0x009ee8ff;
      nodeUI.size = 10;
    } else {
      this.setState({ selectedNodes: new Set(this.state.selectedNodes).add(id) });
      nodeUI.color = 0xFFA500ff;
      nodeUI.size = 20;
    }
    this.renderer.rerender();
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
    // this.loadGraph(snap_fb);

    document.addEventListener('keydown', e => {
      if (e.which === 16) { // shift key
        this.renderer.pause();
        this.setState({ isRendering: false })

        if (!this.multiSelectOverlay) {
          var domOverlay = document.querySelector('#graph-overlay');
          this.multiSelectOverlay = this.createOverlay(domOverlay);
        }
        if (!this.multiSelectOverlayMatrix) {
          var matrixDomOverlay = document.querySelector('#matrix-overlay');
          this.multiSelectOverlayMatrix = this.createMatrixOverlay(matrixDomOverlay);
        }
      }
    });
    document.addEventListener('keyup', e => {
      if (e.which === 16) {
        if (this.multiSelectOverlay) {
          this.multiSelectOverlay.destroy();
          this.multiSelectOverlay = null;
        }
        if (this.multiSelectOverlayMatrix) {
          this.multiSelectOverlayMatrix.destroy();
          this.multiSelectOverlayMatrix = null;
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
        var nodeUI = this.graphics.getNodeUI(node.id);
        if (topLeft.x < nodePos.x && nodePos.x < bottomRight.x &&
          topLeft.y < nodePos.y && nodePos.y < bottomRight.y) {
          currentSelectedNodes.add(node.id);
          nodeUI.color = 0xFFA500ff;
          nodeUI.size = 20;
        } else {
          if (currentSelectedNodes.has(node.id)) {
            currentSelectedNodes.delete(node.id);
            if (!this.state.selectedNodes.has(node.id)) {
              nodeUI.color = 0x009ee8ff;
              nodeUI.size = 10;
            }
          }
        }
      });
      this.renderer.rerender();
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

  createMatrixOverlay = (overlayDom) => {
    var selectionClasName = 'matrix-selection-indicator';
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
    var currentSelectedMatrixNodes = new Set([])

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
      var topLeft = this.matrixGraphics.transformClientToGraphCoordinates({
        x: area.x,
        y: area.y
      });

      var bottomRight = this.matrixGraphics.transformClientToGraphCoordinates({
        x: area.x + area.width,
        y: area.y + area.height
      });

      this.matrix.forEachNode(node => {
        var nodePos = this.matrixLayout.getNodePosition(node.id);
        var xid = (nodePos.x + 400) / 10;
        var yid = (nodePos.y + 400) / 10;
        if (topLeft.x < nodePos.x && nodePos.x < bottomRight.x &&
          topLeft.y < nodePos.y && nodePos.y < bottomRight.y) {
          var nodeUI = this.matrixGraphics.getNodeUI(node.id);
          currentSelectedMatrixNodes.add(node.id);
          nodeUI.color = 0xFFA500ff;
          nodeUI.size = 15;
          [xid, yid].forEach(nid => {
            var nodeUI = this.graphics.getNodeUI(nid);
            currentSelectedNodes.add(nid);
            nodeUI.color = 0xFFA500ff;
            nodeUI.size = 20;
          });
        } else {
          if (currentSelectedMatrixNodes.has(node.id)) {
            currentSelectedMatrixNodes.delete(node.id);
            var nodeUI = this.matrixGraphics.getNodeUI(node.id);
            if (!this.state.matrixSelectedNodes.has(node.id)) {
              nodeUI.color = 0x009ee8ff;
              nodeUI.size = 10;
              [xid, yid].forEach(nid => {
                if (currentSelectedNodes.has(nid)) {
                  currentSelectedNodes.delete(nid);
                  if (!this.state.selectedNodes.has(nid)) {
                    var nodeUI = this.graphics.getNodeUI(nid);
                    nodeUI.color = 0x009ee8ff;
                    nodeUI.size = 10;
                  }
                }
              });
            }
          }
        }
      });
      this.renderer.rerender();
      this.matrixRenderer.rerender();
    });

    dragndrop.onStop(() => {
      selectionIndicator.style.display = 'none';
      this.setState({ selectedNodes: new Set([...this.state.matrixSelectedNodes, ...currentSelectedMatrixNodes]) });
      currentSelectedMatrixNodes = new Set([]);
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
    // console.log(this.state);
    if (this.state.isRendering) {
      this.renderer.pause();
      // console.log("pause");
    } else {
      this.renderer.resume();
      // console.log("resume");
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
    // console.log(alpha, colorHex, color);
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

  clearSelectedNodes = () => {
    this.setState({ selectedNodes: new Set([]), matrixSelectedNodes: new Set([]) });

    this.graph.forEachNode(node => {
      var nodeUI = this.graphics.getNodeUI(node.id);
      nodeUI.color = 0x009ee8ff;
      nodeUI.size = 10;
    })

    this.matrix.forEachNode(node => {
      var nodeUI = this.matrixGraphics.getNodeUI(node.id);
      nodeUI.color = 0x009ee8ff;
      nodeUI.size = 10;
    })

    this.renderer.rerender();
    this.matrixRenderer.rerender();
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

  changeRandomWalkFrom = e => {
    this.setState({ randomWalkFrom: e.target.value });
  }

  changeRandomWalkStep = e => {
    this.setState({ randomWalkStep: e.target.value });
  }

  addNodeToSelectedNodes = async id => {
    var nodeUI = this.graphics.getNodeUI(id);
    await this.setState({ selectedNodes: new Set(this.state.selectedNodes).add(id) });
    nodeUI.color = 0xFFA500ff;
    nodeUI.size = 20;
  }

  doRandomWalk = async () => {
    var currentId = this.state.randomWalkFrom;
    for (let i = 0; i < this.state.randomWalkStep; i++) {
      if (!this.state.selectedNodes.has(currentId)) {
        await this.addNodeToSelectedNodes(currentId);
      }
      var candidates = []
      this.graph.forEachLinkedNode(currentId, (linkedNode, link) => {
        candidates.push(linkedNode.id)
      })
      currentId = candidates[Math.floor(Math.random() * candidates.length)];
    }
    this.renderer.rerender();
  }

  doFilter = () => {
    this.includedNodes = new Set([]);
    this.setState({ selectedNodes: new Set([]) });
    const canExpand = this.state.degreeArea === null || this.state.betweennessArea === null;
    var graphToConsider = canExpand ? this.originalGraph : this.graph
    graphToConsider.forEachNode(node => {
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
      if (isIn) {
        this.includedNodes.add(String(node.id));
        this.graph.addNode(node.id);
      } else {
        this.graph.removeNode(node.id);
      }
    });
    if (canExpand) {
      this.resetLinks();
    }
    this.renderMatrix();
    this.renderer.rerender();
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
      <List>
        {Array.from(this.state.selectedNodes).map(v => <List.Item key={v}>{v}</List.Item>)}
      </List>
    )

    const degreeHist = this.makeHist(this.originalGraphDegreeDist, this.state.degreeArea, this.degreeBrush);
    const betweennessHist = this.state.betweennessEnabled ? this.makeHist(this.originalGraphBetweennessDist, this.state.betweennessArea, this.betweennessBrush) : <Button onClick={this.enableBetweenness}>Enable Betweenness Filter</Button>;

    return (
      <Grid>
        <Grid.Row>
          <Grid.Column width={4} className={"sideDiv"}>
            <h2>Control Panel</h2>
            <Form>
              Data:
              <Form.Group widths='equal'>
                <Form.Button size='mini' onClick={() => { this.loadGraph(snap_fb); this.renderer.rerender(); }}>SNAP</Form.Button>
                <Popup
                  trigger={
                    <Form.Button size='mini' color='red' content='Custom' />
                  }
                  content={<Form>
                    <TextArea placeholder='{"nodes": [{"id":"1"},{"id":"2"}], "edges": [{"id":"0","source":"1","target":"2"}]}' onChange={this.updateInput} />
                    <div style={{ height: '5px' }} />
                    <Button size='mini' color='green' content='Confirm' onClick={() => { this.loadGraph(this.state.userData); this.renderer.rerender(); }} /></Form>}
                  on='click'
                  position='top right'
                />
              </Form.Group>
            </Form>
            <Button onClick={() => {
              var blob = new Blob([this.exportJson()], { type: "text/plain;charset=utf-8" });
              saveAs(blob, `network_data_${moment().format("YYMMDDhhmmss")}.json`);
            }}
            >Export Current Network as JSON</Button>
            <Segment>
              <Header as='h3'><Popup
                trigger={<Icon name='question circle' size='mini' />}
                content="Select by clicking on a node or shift-drag on a graph or by doing random walk below"
                basic
                size="mini"
              />Select Nodes</Header>

              <Form onSubmit={this.doRandomWalk}>
                <Form.Group widths='equal'>
                  <Form.Input fluid label='From' onChange={this.changeRandomWalkFrom} />
                  <Form.Input fluid label='Step' defaultValue="2" onChange={this.changeRandomWalkStep} />
                </Form.Group>
                <Form.Button size='mini'>Go</Form.Button>
              </Form>
              <Header as='h4'>Selected Nodes:</Header>
              <Button size='mini' onClick={this.clearSelectedNodes}>Clear Selected Nodes</Button>
              <div style={{height: '5px'}}/>
              <Button size='mini' onClick={this.newGraphFromSelectedNodes}>Render Selected Nodes as New Network</Button>
              <SelectedNodesList />
            </Segment>

            {
              this.state.isRendering ?
                <button className="ui icon left labeled button" onClick={this.click}><i aria-hidden="true" className="pause icon"></i>Pause Force Layout</button> :
              <button className="ui icon left labeled button" onClick={this.click}><i aria-hidden="true" className="play icon"></i>Resume Force Layout</button>
            }

            <Segment>
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
            </Segment>

            <Segment>
              <Header as='h3'><Popup
                trigger={<Icon name='question circle' size='mini' />}
                content="Drag to draw an area on the histogram to filter. Click on it to reset."
                basic
                size="mini"
              />Filter by Degree</Header>
              {degreeHist}
              <Header as='h3'><Popup
                trigger={<Icon name='question circle' size='mini' />}
                content="Calculating betweenness takes O(V*E) time. It is disabled by default."
                basic
                size="mini"
              />Filter by Betweenness</Header>
              {betweennessHist}
            </Segment>

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
