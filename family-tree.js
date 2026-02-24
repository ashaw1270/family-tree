// Global variables
let treeData = null;
let filteredData = null;
let svg, g, zoom;
let width, height;
let selectedNodes = [];
let pathNodes = new Set();
let pathLinks = new Set();
let currentPath = null; // Store the current path for display
let currentlySelectedNode = null; // Track currently selected node for info panel
let selectedNodeNuclearFamily = new Set(); // Track nuclear family (bigs/littles) of selected node
let isDragging = false; // Track if user is dragging
let dragStartPos = null; // Track drag start position
let pledgeClassNodes = new Set(); // Track nodes in selected pledge class
let pledgeClassNuclearFamily = new Set(); // Track nuclear family (bigs/littles) of pledge class members
let currentPledgeClass = null; // Track currently selected pledge class
let familyNodes = new Set(); // Track nodes in selected family
let familyNuclearFamily = new Set(); // Track nuclear family (bigs/littles) of family members
let currentFamily = null; // Track currently selected family

// Family color mapping - distinct colors for each family
const familyColors = {
    'Cheetah': { fill: '#FF6B35', stroke: '#C94A1F' },      // Orange-red
    'Lion': { fill: '#F7B801', stroke: '#D99A01' },          // Gold
    'Tiger': { fill: '#FF9500', stroke: '#CC7700' },        // Orange
    'Bear': { fill: '#8B4513', stroke: '#6B3410' },          // Brown
    'Wolf': { fill: '#708090', stroke: '#556B7A' },         // Slate gray
    'Eagle': { fill: '#4A90E2', stroke: '#3A70B2' },        // Blue
    'default': { fill: '#fff', stroke: '#629dc7' }          // Default for no family
};

// Get family color
function getFamilyColor(familyName) {
    if (familyName && familyColors[familyName]) {
        return familyColors[familyName];
    }
    return familyColors['default'];
}

// Ensure SVG defs contain linear gradients for each (family1, family2) pair used by nodes (left half / right half).
// Order follows tree layout: left family in tree = left half of node.
function ensureFamilyGradients(nodes) {
    const pairs = new Set();
    nodes.forEach(n => {
        if (n.families && n.families.length >= 2) {
            const ordered = n.familyOrderByPosition || n.families.slice(0, 2);
            const key = JSON.stringify(ordered);
            pairs.add(key);
        }
    });
    const defs = svg.select('defs');
    pairs.forEach(p => {
        const [f1, f2] = JSON.parse(p);
        const id = `gradient-${f1}-${f2}`.replace(/\s+/g, '_');
        if (defs.select(`#${id}`).empty()) {
            const c1 = getFamilyColor(f1).fill;
            const c2 = getFamilyColor(f2).fill;
            defs.append('linearGradient')
                .attr('id', id)
                .attr('x1', '0%').attr('y1', '0%')
                .attr('x2', '100%').attr('y2', '0%')
                .selectAll('stop')
                .data([
                    { offset: '0%', color: c1 },
                    { offset: '50%', color: c1 },
                    { offset: '50%', color: c2 },
                    { offset: '100%', color: c2 }
                ])
                .enter().append('stop')
                .attr('offset', d => d.offset)
                .attr('stop-color', d => d.color);
        }
    });
}

// Get fill for a node: gradient url for two families (left = family on left in tree, right = family on right).
function getNodeFill(d, context) {
    if (context === 'path' && pathNodes.has(d.id)) return '#ff6b6b';
    if (context === 'pledge' && pledgeClassNodes.has(d.id)) return '#ffd700';
    if (d.families && d.families.length >= 2) {
        const ordered = d.familyOrderByPosition || d.families.slice(0, 2);
        const [a, b] = ordered;
        const id = `gradient-${a}-${b}`.replace(/\s+/g, '_');
        return `url(#${id})`;
    }
    const familyColor = getFamilyColor(d.family);
    return familyColor.fill;
}

// Calculate relative luminance of a color (0-1, where 1 is brightest)
function getLuminance(hexColor) {
    // Remove # if present
    const hex = hexColor.replace('#', '');
    
    // Convert to RGB
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    
    // Apply gamma correction
    const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    
    // Calculate relative luminance
    return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

// Get contrasting text color (black or white) based on background color
function getContrastingTextColor(backgroundColor) {
    const luminance = getLuminance(backgroundColor);
    // Use white text on dark backgrounds (luminance < 0.5), black on light backgrounds
    return luminance < 0.5 ? '#ffffff' : '#000000';
}

// Helper: true if person exists and has redacted: true (optional field in JSON)
function isRedacted(personName) {
    if (!personName || !treeData?.people) return false;
    const person = treeData.people.find(p => p.name === personName);
    return !!(person && person.redacted);
}

// Helper function to format name with nickname in quotes after first word
// Example: "John Adams" with nickname 'Johnny' -> 'John "Johnny" Adams'
// Redacted persons always display as "Redacted".
function formatNameWithNickname(personName) {
    if (!personName) return '';
    if (isRedacted(personName)) return 'Redacted';

    // Find the person in the data to get their nickname
    const person = treeData.people.find(p => p.name === personName);
    if (!person || !person.nickname) {
        return personName; // No nickname, return name as is
    }

    const nickname = person.nickname;
    const nameParts = personName.trim().split(/\s+/);

    if (nameParts.length === 1) {
        // Single word name: 'John' -> 'John "Johnny"'
        return `${nameParts[0]} "${nickname}"`;
    } else {
        // Multiple words: 'John Adams' -> 'John "Johnny" Adams'
        return `${nameParts[0]} "${nickname}" ${nameParts.slice(1).join(' ')}`;
    }
}

// Helper function to get name without nickname (for pop-up titles)
function getNameWithoutNickname(personName) {
    if (isRedacted(personName)) return 'Redacted';
    return personName;
}

// Helper function to get nickname for a person (or name if no nickname)
function getNicknameOrName(personName) {
    if (!personName) return '';
    if (isRedacted(personName)) return 'Redacted';
    const person = treeData.people.find(p => p.name === personName);
    return person?.nickname || personName;
}

// Helper function to extract actual name from input value
// Handles cases where user types formatted name, actual name, or nickname.
// Redacted persons are only matched when the user types "Redacted".
function extractActualName(inputValue) {
    if (!inputValue || !treeData?.people) return '';

    const trimmed = inputValue.trim();
    if (!trimmed) return '';

    // Typing "Redacted" resolves to the first redacted person (for path finding, etc.)
    if (trimmed.toLowerCase() === 'redacted') {
        const firstRedacted = treeData.people.find(p => p.redacted);
        return firstRedacted ? firstRedacted.name : trimmed;
    }

    // Do not resolve redacted persons by real name or nickname
    const exactMatch = treeData.people.find(p => !p.redacted && p.name === trimmed);
    if (exactMatch) return exactMatch.name;

    const matchByFormatted = treeData.people.find(p => !p.redacted && formatNameWithNickname(p.name) === trimmed);
    if (matchByFormatted) return matchByFormatted.name;

    const matchByNickname = treeData.people.find(p => !p.redacted && p.nickname && p.nickname.toLowerCase() === trimmed.toLowerCase());
    if (matchByNickname) return matchByNickname.name;

    const partialMatch = treeData.people.find(p => {
        if (p.redacted) return false;
        const nameLower = p.name.toLowerCase();
        return trimmed.toLowerCase().includes(nameLower) || nameLower.includes(trimmed.toLowerCase());
    });
    if (partialMatch) return partialMatch.name;

    return trimmed;
}

// Initialize the visualization
async function init() {
    // Load data
    try {
        const response = await fetch('data.json');
        treeData = await response.json();
        filteredData = treeData;
    } catch (error) {
        console.error('Error loading data:', error);
        alert('Error loading data. Please ensure data.json exists.');
        return;
    }

    // Setup SVG
    const container = d3.select('.visualization-container');
    width = container.node().offsetWidth;
    height = container.node().offsetHeight;

    svg = d3.select('#tree-svg')
        .attr('width', width)
        .attr('height', height);

    // Add SVG filter for glow effect on pledge class nodes
    const defs = svg.append('defs');
    const filter = defs.append('filter')
        .attr('id', 'pledgeClassGlow')
        .attr('x', '-50%')
        .attr('y', '-50%')
        .attr('width', '200%')
        .attr('height', '200%');
    
    filter.append('feGaussianBlur')
        .attr('stdDeviation', '4')
        .attr('result', 'coloredBlur');
    
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    g = svg.append('g');

    // Setup zoom behavior
    zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });

    svg.call(zoom);
    
    // Close info panels when clicking on empty space (SVG background)
    svg.on('click', function(event) {
        // Only close if clicking directly on the SVG element, not on nodes or other elements
        const target = event.target;
        if (target === svg.node() || 
            target === g.node() || 
            target.tagName === 'svg' ||
            (target.tagName === 'g' && !target.classList.contains('node') && !target.closest('.node'))) {
            // Small delay to allow node/family label clicks to process first
            setTimeout(() => {
                if (!isDragging) {
                    // Check if person popup was showing before we hide it
                    const infoPanel = document.getElementById('infoPanel');
                    const personPopupWasShowing = infoPanel && infoPanel.classList.contains('show');
                    
                    // Check if path is showing
                    const pathIsShowing = currentPath !== null && currentPath.length > 0;

                    // Always hide node info (person popup)
                    hideNodeInfo();

                    // If path is showing, clear it and reset zoom/pan when clicking whitespace
                    if (pathIsShowing) {
                        clearPathDisplay();
                        return;
                    }

                    clearPathDisplay();

                    // If person popup was showing, keep filter popup open and zoom to it
                    if (personPopupWasShowing) {
                        // If a family filter is active, keep family popup open and zoom to family
                        if (currentFamily && currentFamily !== 'all') {
                            // Ensure family info is shown (in case it was hidden)
                            const familyNodesCount = familyNodes.size;
                            showFamilyInfo(currentFamily, familyNodesCount);
                            // Zoom to family
                            setTimeout(() => {
                                zoomToFamily(currentFamily);
                            }, 100);
                        }
                        
                        // If a pledge class filter is active, keep pledge class popup open and zoom to pledge class
                        if (currentPledgeClass && currentPledgeClass !== 'all') {
                            // Ensure pledge class info is shown (in case it was hidden)
                            showPledgeClassInfo(currentPledgeClass);
                            // Zoom to pledge class
                            setTimeout(() => {
                                zoomToPledgeClass(currentPledgeClass);
                            }, 100);
                        }
                    } else {
                        // Person popup was not showing, so we're back to just the filter popup
                        // Close filter popups and reset view
                        if (currentFamily && currentFamily !== 'all') {
                            const familyFilter = document.getElementById('familyFilter');
                            if (familyFilter) {
                                familyFilter.value = 'all';
                                familyFilter.dispatchEvent(new Event('change'));
                            }
                        }
                        
                        if (currentPledgeClass && currentPledgeClass !== 'all') {
                            const pledgeClassFilter = document.getElementById('pledgeClassFilter');
                            if (pledgeClassFilter) {
                                pledgeClassFilter.value = 'all';
                                pledgeClassFilter.dispatchEvent(new Event('change'));
                            }
                        }
                        
                        // Zoom to fit all nodes (center view)
                        setTimeout(() => {
                            zoomToFitAllNodes();
                        }, 100);
                    }
                }
            }, 50);
        }
    });

    // Populate family filter
    populateFamilyFilter();
    
    // Populate pledge class filter
    populatePledgeClassFilter();
    
    // Populate family legend
    populateFamilyLegend();
    
    // Initialize center button visibility (should be hidden initially)
    updateCenterButtonVisibility();

    // Hide visualization initially to prevent glitch
    container.style('opacity', '0');
    
    // Build and render tree
    buildTree();
    
    // Zoom to fit all nodes on initial load (after tree is rendered)
    // Apply zoom immediately, then show the visualization
    requestAnimationFrame(() => {
        zoomToFitAllNodes(false); // No animation on initial load
        // Show visualization after zoom is applied
        container.style('opacity', '1');
    });
}

// Build tree with animation
function buildTreeWithAnimation(preservePath = false) {
    // Build tree structure but mark for animation
    buildTree(preservePath, true);
}

// Build the tree structure from the data
function buildTree(preservePath = false, animate = false) {
    // Clear previous visualization
    g.selectAll('*').remove();
    selectedNodes = [];
    
    // Only clear path highlighting if not preserving it
    if (!preservePath) {
        pathNodes.clear();
        pathLinks.clear();
        currentPath = null;
        hidePathPanel();
    }

    // Build node map and adjacency lists
    const nodeMap = new Map();
    const adjacencyList = new Map();
    const allPeople = new Set();

    // Collect all people and build relationships from their bigs/littles
    treeData.people.forEach(person => {
        allPeople.add(person.name);
        nodeMap.set(person.name, person);
        // Use bigs and littles directly from person object, defaulting to empty arrays
        adjacencyList.set(person.name, { 
            littles: person.littles || [], 
            bigs: person.bigs || [] 
        });
    });

    // Build links from relationships (graph structure, not strict tree)
    const links = [];
    treeData.people.forEach(person => {
        const littles = person.littles || [];
        littles.forEach(little => {
            links.push({ source: person.name, target: little });
        });
    });

    // Create nodes array
    const nodes = Array.from(allPeople).map(name => {
        const person = nodeMap.get(name);
        const adj = adjacencyList.get(name) || { littles: [], bigs: [] };
        
        // Calculate depth (distance from root)
        let depth = 0;
        const visited = new Set();
        function calculateDepth(name, currentDepth = 0) {
            if (visited.has(name)) return currentDepth;
            visited.add(name);
            const adj = adjacencyList.get(name) || { littles: [], bigs: [] };
            if (adj.bigs.length === 0) {
                return currentDepth;
            }
            return Math.max(...adj.bigs.map(big => calculateDepth(big, currentDepth + 1)));
        }
        depth = calculateDepth(name);

        // Families: always an array; primary (first) is used for layout
        const families = Array.isArray(person?.families) ? person.families : [];
        const primaryFamily = families[0] || null;

        return {
            id: name,
            name: name,
            family: primaryFamily,
            families: families,
            bondNumber: person?.bondNumber || null,
            pledgeClass: person?.pledgeClass || null,
            nickname: person?.nickname || null,
            littles: adj.littles,
            bigs: adj.bigs,
            littlesCount: adj.littles.length,
            bigsCount: adj.bigs.length,
            depth: depth
        };
    });

    // Show all nodes (family filter now uses highlighting instead of filtering)
    const layout = calculateGraphLayout(nodes, links);
    renderTree(layout.nodes, layout.links, animate);
}


// Measure label width for layout (same font as .node-label: 14px, weight 600)
function measureNodeLabelWidth(node) {
    const label = getNicknameOrName(node.name);
    if (!label) return 40;
    if (!g || !g.node()) return label.length * 8;
    try {
        const temp = g.append('text')
            .attr('class', 'node-label')
            .style('font-size', '14px')
            .style('font-weight', '600')
            .style('visibility', 'hidden')
            .text(label);
        const w = temp.node().getBBox().width;
        temp.remove();
        return w;
    } catch (e) {
        return label.length * 8;
    }
}

// Order family keys so that families with cross-family links are placed adjacent (minimizes long edges).
function orderFamiliesByConnectivity(allFamilyKeys, familyCrossLinks) {
    if (allFamilyKeys.length <= 1) return allFamilyKeys.slice();
    const placed = [];
    const unplaced = new Set(allFamilyKeys);

    const totalCrossWeight = (key) => {
        const m = familyCrossLinks.get(key);
        if (!m) return 0;
        return Array.from(m.values()).reduce((s, n) => s + n, 0);
    };
    const weightBetween = (a, b) => (familyCrossLinks.get(a)?.get(b) || 0);

    // Start with the family that has the most cross-family links
    let best = allFamilyKeys[0];
    let bestWeight = totalCrossWeight(best);
    allFamilyKeys.forEach(k => {
        const w = totalCrossWeight(k);
        if (w > bestWeight) { bestWeight = w; best = k; }
    });
    placed.push(best);
    unplaced.delete(best);

    while (unplaced.size > 0) {
        let bestF = null;
        let bestScore = -1;
        unplaced.forEach(f => {
            const score = placed.reduce((s, p) => s + weightBetween(f, p), 0);
            if (score > bestScore) { bestScore = score; bestF = f; }
        });
        if (bestF === null) bestF = Array.from(unplaced).sort((a, b) => a.localeCompare(b))[0];
        unplaced.delete(bestF);
        const leftWeight = weightBetween(bestF, placed[0]);
        const rightWeight = weightBetween(bestF, placed[placed.length - 1]);
        if (leftWeight >= rightWeight) {
            placed.unshift(bestF);
        } else {
            placed.push(bestF);
        }
    }
    return placed;
}

// Calculate graph layout: each family is laid out primarily vertically (chains stacked by depth)
function calculateGraphLayout(nodes, links) {
    const nodeMap = new Map();
    nodes.forEach(node => {
        nodeMap.set(node.id, node);
    });

    const graphLinks = links
        .map(link => ({
            source: typeof link.source === 'string' ? nodeMap.get(link.source) : link.source,
            target: typeof link.target === 'string' ? nodeMap.get(link.target) : link.target
        }))
        .filter(link => link.source && link.target);

    // Build parent list per node (for chain assignment)
    const parentsMap = new Map();
    nodes.forEach(node => {
        parentsMap.set(node.id, []);
    });
    graphLinks.forEach(link => {
        parentsMap.get(link.target.id).push(link.source.id);
    });

    // Group nodes by family
    const familyToNodes = new Map();
    nodes.forEach(node => {
        const key = node.family || 'default';
        if (!familyToNodes.has(key)) {
            familyToNodes.set(key, []);
        }
        familyToNodes.get(key).push(node);
    });

    // Internal links per family (both endpoints in same family)
    const familyToInternalTargets = new Map();
    const familyToChildren = new Map(); // familyKey -> nodeId -> [child ids in family]
    graphLinks.forEach(link => {
        const src = link.source;
        const tgt = link.target;
        const key = src.family || 'default';
        if ((tgt.family || 'default') !== key) return;
        if (!familyToInternalTargets.has(key)) {
            familyToInternalTargets.set(key, new Set());
            familyToChildren.set(key, new Map());
        }
        familyToInternalTargets.get(key).add(tgt.id);
        const childrenMap = familyToChildren.get(key);
        if (!childrenMap.has(src.id)) childrenMap.set(src.id, []);
        childrenMap.get(src.id).push(tgt.id);
    });

    // Cross-family link counts: order families so connected ones are adjacent (minimize long edges)
    const familyCrossLinks = new Map(); // familyKey -> Map(otherFamilyKey -> count)
    graphLinks.forEach(link => {
        const src = link.source;
        const tgt = link.target;
        const k1 = src.family || 'default';
        const k2 = tgt.family || 'default';
        if (k1 === k2) return;
        if (!familyCrossLinks.has(k1)) familyCrossLinks.set(k1, new Map());
        if (!familyCrossLinks.has(k2)) familyCrossLinks.set(k2, new Map());
        const m1 = familyCrossLinks.get(k1);
        const m2 = familyCrossLinks.get(k2);
        m1.set(k2, (m1.get(k2) || 0) + 1);
        m2.set(k1, (m2.get(k1) || 0) + 1);
    });
    const allFamilyKeys = Array.from(familyToNodes.keys());
    const familyKeys = orderFamiliesByConnectivity(allFamilyKeys, familyCrossLinks);

    // Estimate each node's box width from label (text + modest padding for rect)
    const labelPadding = 60;
    const minGap = 8;
    nodes.forEach(node => {
        const textWidth = measureNodeLabelWidth(node);
        node.estimatedWidth = textWidth + labelPadding;
    });

    const layerHeight = 140;
    const familyGap = 80;
    const startY = height / 4;

    const familyWidths = [];
    const familyBaseX = [];

    // For each family: assign unitX (order), then pixel localX with leaves placed first, parents centered over littles
    for (const familyKey of familyKeys) {
        const familyNodesList = familyToNodes.get(familyKey);
        const internalTargets = familyToInternalTargets.get(familyKey) || new Set();
        const childrenMap = familyToChildren.get(familyKey) || new Map();
        childrenMap.forEach((kids, id) => {
            kids.sort((a, b) => a.localeCompare(b));
        });

        const roots = familyNodesList.filter(n => !internalTargets.has(n.id));
        roots.sort((a, b) => a.id.localeCompare(b.id));

        let nextUnitX = 0;
        const visiting = new Set(); // detect cycles when following littles only (two bigs is not a cycle)
        const path = []; // current path for cycle reporting

        function placeSubtree(node) {
            if (node.unitX !== undefined) return;
            if (visiting.has(node.id)) {
                node.unitX = nextUnitX;
                nextUnitX += 1;
                return;
            }
            visiting.add(node.id);
            path.push(node.id);
            const littles = (childrenMap.get(node.id) || []).filter(id => nodeMap.get(id));
            if (littles.length === 0) {
                node.unitX = nextUnitX;
                nextUnitX += 1;
                path.pop();
                visiting.delete(node.id);
                return;
            }
            for (const lid of littles) {
                const little = nodeMap.get(lid);
                if (little && (little.family || 'default') === familyKey) {
                    if (visiting.has(little.id)) {
                        if (little.unitX === undefined) {
                            little.unitX = nextUnitX;
                            nextUnitX += 1;
                        }
                        const cycle = path.slice(path.indexOf(little.id)).concat([little.id]);
                        console.warn('[Tree] Cycle detected in littles:', cycle.join(' → '));
                    } else {
                        placeSubtree(little);
                    }
                }
            }
            const littlesInFamily = littles.map(id => nodeMap.get(id)).filter(n => n && (n.family || 'default') === familyKey);
            node.unitX = littlesInFamily.reduce((sum, n) => sum + (n.unitX !== undefined ? n.unitX : 0), 0) / littlesInFamily.length;
            path.pop();
            visiting.delete(node.id);
        }

        for (const r of roots) {
            placeSubtree(r);
            nextUnitX += 1;
        }

        // Leaves = nodes with no littles in this family; place them left-to-right with dynamic spacing
        const littlesInFamily = (node) => (childrenMap.get(node.id) || []).map(id => nodeMap.get(id)).filter(n => n && (n.family || 'default') === familyKey);
        const leaves = familyNodesList.filter(n => littlesInFamily(n).length === 0);
        leaves.sort((a, b) => a.unitX - b.unitX);

        const leafLocalX = [];
        leafLocalX[0] = 0;
        for (let i = 1; i < leaves.length; i++) {
            const wPrev = leaves[i - 1].estimatedWidth;
            const wCur = leaves[i].estimatedWidth;
            leafLocalX[i] = leafLocalX[i - 1] + (wPrev + wCur) / 2 + minGap;
        }
        leaves.forEach((n, i) => { n.localX = leafLocalX[i]; });

        // Any node without localX yet (e.g. in a cycle with no leaves) gets one from unitX so we never get NaN
        const defaultSpacing = familyNodesList.reduce((s, n) => s + (n.estimatedWidth || 80), 0) / familyNodesList.length + minGap;
        familyNodesList.forEach(node => {
            if (node.localX === undefined) node.localX = (node.unitX ?? 0) * defaultSpacing;
        });

        // Parents: place at center of their littles (process by depth descending so children have localX first)
        const byDepth = familyNodesList.slice().sort((a, b) => (b.depth || 0) - (a.depth || 0));
        byDepth.forEach(node => {
            const kids = littlesInFamily(node);
            if (kids.length > 0) {
                const sum = kids.reduce((s, c) => s + (c.localX ?? 0), 0);
                const count = kids.length;
                if (Number.isFinite(sum)) node.localX = sum / count;
            }
        });

        const allLeft = familyNodesList.map(n => (n.localX ?? 0) - (n.estimatedWidth || 0) / 2);
        const allRight = familyNodesList.map(n => (n.localX ?? 0) + (n.estimatedWidth || 0) / 2);
        const familyWidth = Math.max(...allRight) - Math.min(...allLeft);
        familyWidths.push(familyWidth);
    }

    // Place families side by side and center the block
    let currentX = 0;
    for (let f = 0; f < familyKeys.length; f++) {
        familyBaseX.push(currentX);
        currentX += familyWidths[f] + familyGap;
    }
    const totalWidth = currentX - familyGap;
    const offset = (width / 2) - (totalWidth / 2);
    for (let i = 0; i < familyBaseX.length; i++) {
        familyBaseX[i] += offset;
    }

    // Convert localX to global x,y per node
    for (let f = 0; f < familyKeys.length; f++) {
        const familyNodesList = familyToNodes.get(familyKeys[f]);
        const leftEdge = Math.min(...familyNodesList.map(n => (n.localX ?? 0) - (n.estimatedWidth || 0) / 2));
        const baseX = familyBaseX[f];
        familyNodesList.forEach(node => {
            const lx = node.localX ?? 0;
            node.x = baseX + lx - leftEdge;
            node.y = startY + (node.depth || 0) * layerHeight;
        });
    }

    // For two-family nodes: order families by layout position (left column = left half of node)
    const familyCenterX = new Map();
    for (let f = 0; f < familyKeys.length; f++) {
        familyCenterX.set(familyKeys[f], familyBaseX[f] + familyWidths[f] / 2);
    }
    nodes.forEach(node => {
        if (node.families && node.families.length >= 2) {
            const two = node.families.slice(0, 2);
            node.familyOrderByPosition = [...two].sort((a, b) =>
                (familyCenterX.get(a) ?? 0) - (familyCenterX.get(b) ?? 0));
        }
    });

    return { nodes, links: graphLinks };
}

// Render the tree
function renderTree(nodes, links, animate = false) {
    if (animate) {
        // Fade out existing elements
        g.selectAll('.link')
            .transition()
            .duration(300)
            .style('opacity', 0);
        
        g.selectAll('.node')
            .transition()
            .duration(300)
            .style('opacity', 0);
        
        
        // Wait for fade out, then rebuild
        setTimeout(() => {
            renderTreeInternal(nodes, links, true);
        }, 300);
    } else {
        renderTreeInternal(nodes, links, false);
    }
}

// Internal render function
function renderTreeInternal(nodes, links, fadeIn = false) {
    // Clear previous
    g.selectAll('.link').remove();
    g.selectAll('.node').remove();

    // Ensure gradients exist for two-family nodes (left/right half colors)
    ensureFamilyGradients(nodes);

    // Draw links
    const link = g.selectAll('.link')
        .data(links)
        .enter().append('line')
        .attr('class', d => {
            let classes = 'link';
            const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
            const targetId = typeof d.target === 'object' ? d.target.id : d.target;
            if (pathLinks.has(`${sourceId}-${targetId}`) || 
                pathLinks.has(`${targetId}-${sourceId}`)) {
                classes += ' path-link';
            }
            return classes;
        })
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y)
        .style('opacity', d => {
            const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
            const targetId = typeof d.target === 'object' ? d.target.id : d.target;
            
            // Fade links if a person is selected (and nothing else)
            if (currentlySelectedNode && !currentFamily && (!currentPledgeClass || currentPledgeClass === 'all') && pathNodes.size === 0) {
                const sourceIsSelected = sourceId === currentlySelectedNode.id;
                const targetIsSelected = targetId === currentlySelectedNode.id;
                const sourceInNuclearFamily = selectedNodeNuclearFamily.has(sourceId);
                const targetInNuclearFamily = selectedNodeNuclearFamily.has(targetId);
                
                // Full opacity only for:
                // 1. Edges between selected person and nuclear family
                // 2. Edges between nuclear family members
                // All other edges (including edges from nuclear family to outside) are faded
                if ((sourceIsSelected && targetInNuclearFamily) || 
                    (targetIsSelected && sourceInNuclearFamily) ||
                    (sourceInNuclearFamily && targetInNuclearFamily)) {
                    return fadeIn ? 0 : 1; // Full opacity
                } else {
                    return fadeIn ? 0 : 0.15; // Very faded for other links
                }
            }
            
            // Fade links if path is highlighted and link is not part of the path
            if (pathNodes.size > 0) {
                const sourceInPath = pathNodes.has(sourceId);
                const targetInPath = pathNodes.has(targetId);
                const isPathLink = pathLinks.has(`${sourceId}-${targetId}`) || 
                                   pathLinks.has(`${targetId}-${sourceId}`);
                
                if (isPathLink || (sourceInPath && targetInPath)) {
                    return fadeIn ? 0 : 1; // Full opacity for path links
                } else {
                    return fadeIn ? 0 : 0.15; // Very faded for other links
                }
            }
            
            // Fade links if pledge class is selected
            if (currentPledgeClass && currentPledgeClass !== 'all') {
                const sourceInPledgeClass = pledgeClassNodes.has(sourceId);
                const targetInPledgeClass = pledgeClassNodes.has(targetId);
                const sourceInNuclearFamily = pledgeClassNuclearFamily.has(sourceId);
                const targetInNuclearFamily = pledgeClassNuclearFamily.has(targetId);
                
                // Full opacity only for:
                // 1. Edges between pledge class nodes and nuclear family
                // 2. Edges between nuclear family members
                // All other edges (including edges from nuclear family to outside) are faded
                if ((sourceInPledgeClass && targetInNuclearFamily) || 
                    (targetInPledgeClass && sourceInNuclearFamily) ||
                    (sourceInNuclearFamily && targetInNuclearFamily)) {
                    return fadeIn ? 0 : 1; // Full opacity
                } else {
                    return fadeIn ? 0 : 0.15; // Very faded for other links
                }
            }
            // Fade links if family is selected
            if (currentFamily && currentFamily !== 'all') {
                const sourceInFamily = familyNodes.has(sourceId);
                const targetInFamily = familyNodes.has(targetId);
                const sourceInNuclearFamily = familyNuclearFamily.has(sourceId);
                const targetInNuclearFamily = familyNuclearFamily.has(targetId);
                
                // Full opacity only for:
                // 1. Edges between family nodes and nuclear family
                // 2. Edges between nuclear family members
                // All other edges (including edges from nuclear family to outside) are faded
                if ((sourceInFamily && targetInNuclearFamily) || 
                    (targetInFamily && sourceInNuclearFamily) ||
                    (sourceInNuclearFamily && targetInNuclearFamily)) {
                    return fadeIn ? 0 : 1; // Full opacity
                } else {
                    return fadeIn ? 0 : 0.15; // Very faded for other links
                }
            }
            return fadeIn ? 0 : 1;
        });

    // Draw nodes
    const node = g.selectAll('.node')
        .data(nodes)
        .enter().append('g')
        .attr('class', d => {
            let classes = 'node';
            if (pathNodes.has(d.id)) {
                classes += ' path-node';
            }
            if (pledgeClassNodes.has(d.id)) {
                classes += ' pledge-class-node';
            }
            if (familyNodes.has(d.id)) {
                classes += ' family-node';
            }
            return classes;
        })
        .attr('transform', d => `translate(${d.x},${d.y})`)
        .style('opacity', d => {
            // Fade nodes if a person is selected (and nothing else) and node is not the selected person or in nuclear family
            if (currentlySelectedNode && !currentFamily && (!currentPledgeClass || currentPledgeClass === 'all') && pathNodes.size === 0) {
                if (d.id === currentlySelectedNode.id || selectedNodeNuclearFamily.has(d.id)) {
                    return fadeIn ? 0 : 1; // Full opacity for selected person and nuclear family
                } else {
                    return fadeIn ? 0 : 0.15; // Very faded for other nodes
                }
            }
            
            // Fade nodes if path is highlighted and node is not part of the path
            if (pathNodes.size > 0 && !pathNodes.has(d.id)) {
                return fadeIn ? 0 : 0.15; // Very faded for nodes not in path
            }
            
            // Fade nodes if pledge class is selected and node is not in pledge class
            if (currentPledgeClass && currentPledgeClass !== 'all' && !pledgeClassNodes.has(d.id) && !pathNodes.has(d.id)) {
                // Nuclear family members (bigs/littles) should be less faded
                if (pledgeClassNuclearFamily.has(d.id)) {
                    return fadeIn ? 0 : 0.6; // Less faded for nuclear family
                }
                return fadeIn ? 0 : 0.15; // Very faded for other nodes
            }
            // Fade nodes if family is selected and node is not in family
            if (currentFamily && currentFamily !== 'all' && !familyNodes.has(d.id) && !pathNodes.has(d.id)) {
                // Nuclear family members (bigs/littles) should be less faded
                if (familyNuclearFamily.has(d.id)) {
                    return fadeIn ? 0 : 0.6; // Less faded for nuclear family
                }
                return fadeIn ? 0 : 0.15; // Very faded for other nodes
            }
            return fadeIn ? 0 : 1;
        })
        .on('mousedown', function(event) {
            // Track drag start - reset drag state
            isDragging = false;
            dragStartPos = d3.pointer(event, svg.node());
        })
        .on('mousemove', function(event) {
            // Check if this is a drag
            if (dragStartPos) {
                const currentPos = d3.pointer(event, svg.node());
                const distance = Math.sqrt(
                    Math.pow(currentPos[0] - dragStartPos[0], 2) + 
                    Math.pow(currentPos[1] - dragStartPos[1], 2)
                );
                if (distance > 5) { // If moved more than 5 pixels, it's a drag
                    isDragging = true;
                }
            }
        })
        .on('click', function(event, d) {
            event.stopPropagation(); // Prevent SVG click handler
            
            // Don't process click if it was a drag
            if (isDragging) {
                isDragging = false;
                dragStartPos = null;
                return;
            }
            
            // Don't clear path if showing - keep path when clicking on nodes
            // clearPathDisplay(); // Removed - path should persist when clicking nodes
            
            // Don't close family info - keep it open so both panels can be visible
            
            // If clicking the same node, toggle (close) the panel
            if (currentlySelectedNode && currentlySelectedNode.id === d.id) {
                hideNodeInfo();
                highlightNode(null); // Clear highlighting
            } else {
                // Show info for this node
                showNodeInfo(d);
                highlightNode(d.id);
                // Center and zoom to this node
                zoomToNode(d);
            }
            
            dragStartPos = null;
        })
        .on('mouseup', function() {
            // Reset drag tracking on mouseup
            dragStartPos = null;
        })
        .on('mouseover', function(event, d) {
            const rect = d3.select(this).select('rect');
            const text = d3.select(this).select('text');
            // Get current text width to calculate new rectangle size
            const textNode = text.node();
            if (textNode) {
                const textWidth = textNode.getBBox().width || d.name.length * 8;
                const baseWidth = textWidth + 36;
                const baseHeight = 34;
                if (pledgeClassNodes.has(d.id) || familyNodes.has(d.id)) {
                    rect.attr('width', baseWidth + 8).attr('height', baseHeight + 4)
                        .attr('x', -(baseWidth + 8) / 2).attr('y', -(baseHeight + 4) / 2);
                } else {
                    rect.attr('width', baseWidth + 4).attr('height', baseHeight + 2)
                        .attr('x', -(baseWidth + 4) / 2).attr('y', -(baseHeight + 2) / 2);
                }
            }
        })
        .on('mouseout', function(event, d) {
            const rect = d3.select(this).select('rect');
            const text = d3.select(this).select('text');
            // Get current text width to calculate rectangle size
            const textNode = text.node();
            if (textNode) {
                const textWidth = textNode.getBBox().width || d.name.length * 8;
                const baseWidth = textWidth + 36;
                const baseHeight = 34;
                if (pathNodes.has(d.id)) {
                    rect.attr('width', baseWidth + 4).attr('height', baseHeight + 2)
                        .attr('x', -(baseWidth + 4) / 2).attr('y', -(baseHeight + 2) / 2);
                } else if (pledgeClassNodes.has(d.id) || familyNodes.has(d.id)) {
                    rect.attr('width', baseWidth + 6).attr('height', baseHeight + 3)
                        .attr('x', -(baseWidth + 6) / 2).attr('y', -(baseHeight + 3) / 2);
                } else {
                    rect.attr('width', baseWidth).attr('height', baseHeight)
                        .attr('x', -baseWidth / 2).attr('y', -baseHeight / 2);
                }
            }
        });

    // Create text first to measure its width
    const textElements = node.append('text')
        .attr('class', 'node-label')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('dy', 0)
        .text(d => getNicknameOrName(d.name))
        .style('font-weight', d => {
            // Slightly bolder for highlighted node labels
            if (pledgeClassNodes.has(d.id) || familyNodes.has(d.id)) return '700';
            return '600';
        })
        .style('opacity', d => {
            // Fade labels if a person is selected (and nothing else) and node is not the selected person or in nuclear family
            if (currentlySelectedNode && !currentFamily && (!currentPledgeClass || currentPledgeClass === 'all') && pathNodes.size === 0) {
                if (d.id === currentlySelectedNode.id || selectedNodeNuclearFamily.has(d.id)) {
                    return 1; // Full opacity for selected person and nuclear family labels
                } else {
                    return 0.15; // Very faded for other labels
                }
            }
            
            // Fade labels if path is highlighted and node is not part of the path
            if (pathNodes.size > 0 && !pathNodes.has(d.id)) {
                return 0.15; // Very faded for labels not in path
            }
            
            // Fade labels if pledge class is selected and node is not in pledge class
            if (currentPledgeClass && currentPledgeClass !== 'all' && !pledgeClassNodes.has(d.id) && !pathNodes.has(d.id)) {
                // Nuclear family members (bigs/littles) should be less faded
                if (pledgeClassNuclearFamily.has(d.id)) {
                    return 0.6; // Less faded for nuclear family labels
                }
                return 0.15; // Very faded for other labels
            }
            // Fade labels if family is selected and node is not in family
            if (currentFamily && currentFamily !== 'all' && !familyNodes.has(d.id) && !pathNodes.has(d.id)) {
                // Nuclear family members (bigs/littles) should be less faded
                if (familyNuclearFamily.has(d.id)) {
                    return 0.6; // Less faded for nuclear family labels
                }
                return 0.15; // Very faded for other labels
            }
            return 1;
        })
        .style('visibility', 'hidden'); // Temporarily hide to measure

    // Create rectangles based on text width
    node.each(function(d) {
        const currentNode = d3.select(this);
        const textNode = currentNode.select('text').node();
        const textWidth = textNode ? textNode.getBBox().width : d.name.length * 8;
        const baseWidth = textWidth + 36;
        const baseHeight = 34;
        
        let rectWidth, rectHeight;
        if (pathNodes.has(d.id)) {
            rectWidth = baseWidth + 4;
            rectHeight = baseHeight + 2;
        } else if (pledgeClassNodes.has(d.id) || familyNodes.has(d.id)) {
            rectWidth = baseWidth + 6;
            rectHeight = baseHeight + 3;
        } else {
            rectWidth = baseWidth;
            rectHeight = baseHeight;
        }
        
        // Determine fill: gradient (left/right colors) for two families, else single family color
        let fillColor;
        if (pathNodes.has(d.id)) {
            fillColor = '#ff6b6b';
        } else if (pledgeClassNodes.has(d.id)) {
            fillColor = '#ffd700'; // Gold
        } else {
            fillColor = getNodeFill(d, 'normal');
        }
        
        // Stroke: use first family when node has multiple families
        const primaryColor = getFamilyColor(d.family);
        let strokeColor;
        if (pathNodes.has(d.id)) {
            strokeColor = '#c92a2a';
        } else if (pledgeClassNodes.has(d.id)) {
            strokeColor = '#ff8c00'; // Orange
        } else {
            strokeColor = primaryColor.stroke;
        }
        
        // Determine stroke width
        let strokeWidth;
        if (pathNodes.has(d.id)) {
            strokeWidth = '5px';
        } else if (pledgeClassNodes.has(d.id) || familyNodes.has(d.id)) {
            strokeWidth = '6px';
        } else {
            strokeWidth = '3px';
        }
        
        currentNode.insert('rect', 'text')
            .attr('width', rectWidth)
            .attr('height', rectHeight)
            .attr('x', -rectWidth / 2)
            .attr('y', -rectHeight / 2)
            .attr('rx', 4) // Rounded corners
            .style('fill', fillColor)
            .style('stroke', strokeColor)
            .style('stroke-width', strokeWidth);
        
        // Set text color: for two-family nodes use primary family fill for contrast
        const bgForContrast = (d.families && d.families.length >= 2) ? primaryColor.fill : (typeof fillColor === 'string' && fillColor.startsWith('url(') ? primaryColor.fill : fillColor);
        const textColor = getContrastingTextColor(bgForContrast);
        currentNode.select('text')
            .style('fill', textColor);
    });

    // Make text visible now
    textElements.style('visibility', 'visible');
    
    // Fade in if needed
    if (fadeIn) {
        link.transition()
            .duration(400)
            .style('opacity', d => {
                const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
                const targetId = typeof d.target === 'object' ? d.target.id : d.target;
                
                // Fade links if a person is selected (and nothing else)
                if (currentlySelectedNode && !currentFamily && (!currentPledgeClass || currentPledgeClass === 'all') && pathNodes.size === 0) {
                    const sourceIsSelected = sourceId === currentlySelectedNode.id;
                    const targetIsSelected = targetId === currentlySelectedNode.id;
                    const sourceInNuclearFamily = selectedNodeNuclearFamily.has(sourceId);
                    const targetInNuclearFamily = selectedNodeNuclearFamily.has(targetId);
                    
                    // Full opacity only for:
                    // 1. Edges between selected person and nuclear family
                    // 2. Edges between nuclear family members
                    // All other edges (including edges from nuclear family to outside) are faded
                    if ((sourceIsSelected && targetInNuclearFamily) || 
                        (targetIsSelected && sourceInNuclearFamily) ||
                        (sourceInNuclearFamily && targetInNuclearFamily)) {
                        return 1; // Full opacity
                    } else {
                        return 0.15; // Very faded for other links
                    }
                }
                
                // Fade links if path is highlighted and link is not part of the path
                if (pathNodes.size > 0) {
                    const sourceInPath = pathNodes.has(sourceId);
                    const targetInPath = pathNodes.has(targetId);
                    const isPathLink = pathLinks.has(`${sourceId}-${targetId}`) || 
                                       pathLinks.has(`${targetId}-${sourceId}`);
                    
                    if (isPathLink || (sourceInPath && targetInPath)) {
                        return 1; // Full opacity for path links
                    } else {
                        return 0.15; // Very faded for other links
                    }
                }
                
                // Fade links if pledge class is selected
                if (currentPledgeClass && currentPledgeClass !== 'all') {
                    const sourceInPledgeClass = pledgeClassNodes.has(sourceId);
                    const targetInPledgeClass = pledgeClassNodes.has(targetId);
                    const sourceInNuclearFamily = pledgeClassNuclearFamily.has(sourceId);
                    const targetInNuclearFamily = pledgeClassNuclearFamily.has(targetId);
                    
                    // Full opacity only for:
                    // 1. Edges between pledge class nodes and nuclear family
                    // 2. Edges between nuclear family members
                    // All other edges (including edges from nuclear family to outside) are faded
                    if ((sourceInPledgeClass && targetInNuclearFamily) || 
                        (targetInPledgeClass && sourceInNuclearFamily) ||
                        (sourceInNuclearFamily && targetInNuclearFamily)) {
                        return 1; // Full opacity
                    } else {
                        return 0.15; // Very faded for other links
                    }
                }
                // Fade links if family is selected
                if (currentFamily && currentFamily !== 'all') {
                    const sourceInFamily = familyNodes.has(sourceId);
                    const targetInFamily = familyNodes.has(targetId);
                    const sourceInNuclearFamily = familyNuclearFamily.has(sourceId);
                    const targetInNuclearFamily = familyNuclearFamily.has(targetId);
                    
                    // Full opacity only for:
                    // 1. Edges between family nodes and nuclear family
                    // 2. Edges between nuclear family members
                    // All other edges (including edges from nuclear family to outside) are faded
                    if ((sourceInFamily && targetInNuclearFamily) || 
                        (targetInFamily && sourceInNuclearFamily) ||
                        (sourceInNuclearFamily && targetInNuclearFamily)) {
                        return 1; // Full opacity
                    } else {
                        return 0.15; // Very faded for other links
                    }
                }
                return 1;
            });
        
        node.transition()
            .duration(400)
            .style('opacity', d => {
                // Fade nodes if a person is selected (and nothing else) and node is not the selected person or in nuclear family
                if (currentlySelectedNode && !currentFamily && (!currentPledgeClass || currentPledgeClass === 'all') && pathNodes.size === 0) {
                    if (d.id === currentlySelectedNode.id || selectedNodeNuclearFamily.has(d.id)) {
                        return 1; // Full opacity for selected person and nuclear family
                    } else {
                        return 0.15; // Very faded for other nodes
                    }
                }
                
                // Fade nodes if path is highlighted and node is not part of the path
                if (pathNodes.size > 0 && !pathNodes.has(d.id)) {
                    return 0.15; // Very faded for nodes not in path
                }
                
                // Fade nodes if pledge class is selected and node is not in pledge class
                if (currentPledgeClass && currentPledgeClass !== 'all' && !pledgeClassNodes.has(d.id) && !pathNodes.has(d.id)) {
                    // Nuclear family members (bigs/littles) should be less faded
                    if (pledgeClassNuclearFamily.has(d.id)) {
                        return 0.6; // Less faded for nuclear family
                    }
                    return 0.15; // Very faded for other nodes
                }
                // Fade nodes if family is selected and node is not in family
                if (currentFamily && currentFamily !== 'all' && !familyNodes.has(d.id) && !pathNodes.has(d.id)) {
                    // Nuclear family members (bigs/littles) should be less faded
                    if (familyNuclearFamily.has(d.id)) {
                        return 0.6; // Less faded for nuclear family
                    }
                    return 0.15; // Very faded for other nodes
                }
                return 1;
            });
        
        // Also fade in labels
        node.selectAll('.node-label')
            .transition()
            .duration(400)
            .style('opacity', d => {
                // Fade labels if a person is selected (and nothing else) and node is not the selected person or in nuclear family
                if (currentlySelectedNode && !currentFamily && (!currentPledgeClass || currentPledgeClass === 'all') && pathNodes.size === 0) {
                    if (d.id === currentlySelectedNode.id || selectedNodeNuclearFamily.has(d.id)) {
                        return 1; // Full opacity for selected person and nuclear family labels
                    } else {
                        return 0.15; // Very faded for other labels
                    }
                }
                
                // Fade labels if path is highlighted and node is not part of the path
                if (pathNodes.size > 0 && !pathNodes.has(d.id)) {
                    return 0.15; // Very faded for labels not in path
                }
                
                // Fade labels if pledge class is selected and node is not in pledge class
                if (currentPledgeClass && currentPledgeClass !== 'all' && !pledgeClassNodes.has(d.id) && !pathNodes.has(d.id)) {
                    // Nuclear family members (bigs/littles) should be less faded
                    if (pledgeClassNuclearFamily.has(d.id)) {
                        return 0.6; // Less faded for nuclear family labels
                    }
                    return 0.15; // Very faded for other labels
                }
                // Fade labels if family is selected and node is not in family
                if (currentFamily && currentFamily !== 'all' && !familyNodes.has(d.id) && !pathNodes.has(d.id)) {
                    // Nuclear family members (bigs/littles) should be less faded
                    if (familyNuclearFamily.has(d.id)) {
                        return 0.6; // Less faded for nuclear family labels
                    }
                    return 0.15; // Very faded for other labels
                }
                return 1;
            });
    }
}

// Add family labels positioned near each family's cluster
function addFamilyLabels(nodes, fadeIn = false) {
    // Group nodes by family
    const families = new Map();
    
    nodes.forEach(node => {
        if (node.family) {
            if (!families.has(node.family)) {
                families.set(node.family, []);
            }
            families.get(node.family).push(node);
        }
    });
    
    // Calculate position and add label for each family
    families.forEach((familyNodes, familyName) => {
        if (familyNodes.length === 0) return;
        
        // Calculate bounding box for the family
        const xCoords = familyNodes.map(n => n.x);
        const yCoords = familyNodes.map(n => n.y);
        
        const minX = Math.min(...xCoords);
        const maxX = Math.max(...xCoords);
        const minY = Math.min(...yCoords);
        const maxY = Math.max(...yCoords);
        
        // Position label above the family cluster, centered horizontally
        const labelX = (minX + maxX) / 2;
        const labelY = minY - 100; // Position above the topmost node with more spacing
        
        // Create temporary text element to measure actual width
        const tempText = g.append('text')
            .attr('class', 'family-label')
            .attr('x', 0)
            .attr('y', 0)
            .attr('text-anchor', 'middle')
            .attr('font-size', '28px')
            .attr('font-weight', '700')
            .text(familyName)
            .style('visibility', 'hidden');
        
        const textBBox = tempText.node().getBBox();
        tempText.remove();
        
        // Add background rectangle for better visibility
        const bgPadding = 15;
        const textWidth = textBBox.width || familyName.length * 16;
        const textHeight = textBBox.height || 35;
        
        // Get family color
        const familyColor = getFamilyColor(familyName);
        
        // Create a group for the clickable family label
        const familyLabelGroup = g.append('g')
            .attr('class', 'family-label-group')
            .style('opacity', fadeIn ? 0 : 1);
        
        // Add background rectangle for better visibility (this will be clickable)
        const bgRect = familyLabelGroup.append('rect')
            .attr('class', 'family-label-bg')
            .attr('x', labelX - textWidth / 2 - bgPadding)
            .attr('y', labelY - textHeight / 2 - bgPadding)
            .attr('width', textWidth + bgPadding * 2)
            .attr('height', textHeight + bgPadding * 2)
            .attr('rx', 10)
            .attr('fill', 'rgba(255, 255, 255, 0.98)')
            .attr('stroke', familyColor.stroke)
            .attr('stroke-width', 3)
            .attr('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))')
            .style('cursor', 'pointer')
            .on('click', function(event) {
                event.stopPropagation(); // Prevent node clicks
                // Set the family filter dropdown to this family
                const familyFilter = document.getElementById('familyFilter');
                if (familyFilter) {
                    familyFilter.value = familyName;
                    // Trigger the change event to apply the same highlighting behavior
                    familyFilter.dispatchEvent(new Event('change'));
                }
            });
        
        // Add family name text with family color
        familyLabelGroup.append('text')
            .attr('class', 'family-label')
            .attr('x', labelX)
            .attr('y', labelY)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', familyColor.stroke)
            .text(familyName);
        
        // Add hover effect on the rectangle
        bgRect.on('mouseover', function() {
            d3.select(this)
                .attr('fill', familyColor.fill + '40') // Semi-transparent family color
                .attr('stroke-width', 4);
        }).on('mouseout', function() {
            d3.select(this)
                .attr('fill', 'rgba(255, 255, 255, 0.98)')
                .attr('stroke-width', 3);
        });
        
        // Fade in if needed
        if (fadeIn) {
            familyLabelGroup.transition()
                .duration(400)
                .style('opacity', 1);
        }
    });
}

// Helper: escape HTML so names can't break popup markup
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to create a clickable link for a person (or red plain text if person not in data)
function createPersonLink(personName) {
    if (!personName) return '';
    const inData = treeData && treeData.people && treeData.people.some(p => p.name === personName);
    const displayName = inData ? getNicknameOrName(personName) : personName;
    const safeName = escapeHtml(displayName);
    if (inData) {
        return `<a href="#" class="info-link person-link" data-person="${escapeHtml(personName)}">${safeName}</a>`;
    }
    return `<span class="person-not-in-data">${safeName}</span>`;
}

// Helper function to create a clickable link for a family
function createFamilyLink(familyName) {
    return `<a href="#" class="info-link family-link" data-family="${familyName}">${familyName}</a>`;
}

// Helper function to create a clickable link for a pledge class
function createPledgeClassLink(pledgeClassName) {
    return `<a href="#" class="info-link pledge-class-link" data-pledge-class="${pledgeClassName}">${pledgeClassName}</a>`;
}

// Helper function to select a person by name (opens their node info)
function selectPersonByName(personName) {
    // Find the person in the data
    const personData = treeData.people.find(p => p.name === personName);
    if (!personData) {
        return;
    }
    
    // Get bigs and littles directly from person data
    const adj = {
        littles: personData.littles || [],
        bigs: personData.bigs || []
    };
    
    // Families: always an array from JSON
    const families = Array.isArray(personData.families) ? personData.families : [];
    const primaryFamily = families[0] || null;

    // Create node object
    const node = {
        id: personName,
        name: personName,
        family: primaryFamily,
        families: families,
        bondNumber: personData.bondNumber || null,
        pledgeClass: personData.pledgeClass || null,
        nickname: personData.nickname || null,
        littles: adj.littles,
        bigs: adj.bigs,
        littlesCount: adj.littles.length,
        bigsCount: adj.bigs.length
    };
    
    // Show info for this node
    showNodeInfo(node);
    highlightNode(node.id);
    
    // Find and zoom to the node in the visualization
    const nodeElement = g.selectAll('.node').filter(d => d.id === personName);
    if (nodeElement.size() > 0) {
        const nodeData = nodeElement.datum();
        zoomToNode(nodeData);
    }
}

// Search for a person by name or nickname (partial, case-insensitive) and select them like a node click.
// Redacted persons are not findable by their real name or nickname; they can only be found via "redacted".
function searchAndSelectPerson() {
    const input = document.getElementById('personSearch');
    if (!input || !treeData || !treeData.people) return;
    const query = (input.value || '').trim();
    if (!query) return;
    const q = query.toLowerCase();
    const people = treeData.people;
    // Exclude redacted from name/nickname matches so their real name is never revealed by search
    const exactName = people.find(p => !p.redacted && p.name.toLowerCase() === q);
    if (exactName) {
        selectPersonByName(exactName.name);
        return;
    }
    const exactNick = people.find(p => !p.redacted && (p.nickname || '').toLowerCase() === q);
    if (exactNick) {
        selectPersonByName(exactNick.name);
        return;
    }
    // Allow finding redacted persons only by typing "redacted"
    if (q === 'redacted') {
        const redactedPeople = people.filter(p => p.redacted);
        if (redactedPeople.length > 0) {
            selectPersonByName(redactedPeople[0].name);
            return;
        }
    }
    const partial = people.filter(p => {
        if (p.redacted) return false;
        return p.name.toLowerCase().includes(q) || (p.nickname || '').toLowerCase().includes(q);
    });
    if (partial.length === 0) {
        showErrorPopup('No person found matching "' + query + '"');
        return;
    }
    selectPersonByName(partial[0].name);
}

// Helper function to select a family (triggers family filter)
function selectFamily(familyName) {
    const familyFilter = document.getElementById('familyFilter');
    if (familyFilter) {
        familyFilter.value = familyName;
        familyFilter.dispatchEvent(new Event('change'));
    }
}

// Helper function to select a pledge class (triggers pledge class filter)
function selectPledgeClass(pledgeClassName) {
    const pledgeClassFilter = document.getElementById('pledgeClassFilter');
    if (pledgeClassFilter) {
        pledgeClassFilter.value = pledgeClassName;
        pledgeClassFilter.dispatchEvent(new Event('change'));
    }
}

// Show node information
function showNodeInfo(node) {
    currentlySelectedNode = node;
    
    // Track nuclear family (bigs and littles) of selected node
    selectedNodeNuclearFamily.clear();
    if (node.bigs && node.bigs.length > 0) {
        node.bigs.forEach(big => selectedNodeNuclearFamily.add(big));
    }
    if (node.littles && node.littles.length > 0) {
        node.littles.forEach(little => selectedNodeNuclearFamily.add(little));
    }
    const panel = document.getElementById('infoPanel');
    const nameEl = document.getElementById('infoName');
    const detailsEl = document.getElementById('infoDetails');

    // Check if pledge class panel is visible and adjust position
    const pledgeClassPanel = document.getElementById('pledgeClassInfoPanel');
    const familyPanel = document.getElementById('familyInfoPanel');
    
    let topOffset = 20; // Default position
    
    // Check for pledge class panel first
    if (pledgeClassPanel && pledgeClassPanel.classList.contains('show')) {
        const pledgeClassHeight = pledgeClassPanel.offsetHeight;
        const gap = 20;
        topOffset = 20 + pledgeClassHeight + gap;
    }
    
    // Check for family panel (may be below pledge class panel if both are visible)
    if (familyPanel && familyPanel.classList.contains('show')) {
        const familyHeight = familyPanel.offsetHeight;
        const gap = 20;
        // If pledge class panel is also visible, position below it, otherwise below family panel
        if (pledgeClassPanel && pledgeClassPanel.classList.contains('show')) {
            const pledgeClassHeight = pledgeClassPanel.offsetHeight;
            topOffset = 20 + pledgeClassHeight + gap + familyHeight + gap;
        } else {
            topOffset = 20 + familyHeight + gap;
        }
    }
    
    panel.style.top = topOffset + 'px';

    // Use name without nickname in the title
    nameEl.textContent = getNameWithoutNickname(node.name);
    
    let details = [];
    
    // Nickname - show first if it exists (never show for redacted persons)
    if (node.nickname && !isRedacted(node.name)) {
        details.push(`<strong>Nickname:</strong> ${node.nickname}`);
    }
    
    // Bond Number
    if (node.bondNumber !== null && node.bondNumber !== undefined) {
        details.push(`<strong>Bond Number:</strong> ${node.bondNumber}`);
    } else {
        details.push(`<strong>Bond Number:</strong> Unknown`);
    }
    
    // Pledge Class
    if (node.pledgeClass) {
        details.push(`<strong>Pledge Class:</strong> ${createPledgeClassLink(node.pledgeClass)}`);
    } else {
        details.push(`<strong>Pledge Class:</strong> Unknown`);
    }
    
    // Family / Families
    if (node.families && node.families.length > 0) {
        if (node.families.length === 1) {
            details.push(`<strong>Family:</strong> ${createFamilyLink(node.families[0])}`);
        } else {
            const familyLinks = node.families.map(f => createFamilyLink(f)).join(', ');
            details.push(`<strong>Families:</strong> ${familyLinks}`);
        }
    } else {
        details.push(`<strong>Family:</strong> Unknown`);
    }
    
    // Big Brother(s)
    if (node.bigs && node.bigs.length > 0) {
        if (node.bigs.length === 1) {
            details.push(`<strong>Big:</strong> ${createPersonLink(node.bigs[0])}`);
        } else {
            const bigLinks = node.bigs.map(big => createPersonLink(big)).join(', ');
            details.push(`<strong>Bigs:</strong> ${bigLinks}`);
        }
    } else {
        details.push(`<strong>Big:</strong> Unknown`);
    }
    
    // Little Brother(s)
    if (node.littles && node.littles.length > 0) {
        if (node.littles.length === 1) {
            details.push(`<strong>Little:</strong> ${createPersonLink(node.littles[0])}`);
        } else {
            const littleLinks = node.littles.map(little => createPersonLink(little)).join(', ');
            details.push(`<strong>Littles:</strong> ${littleLinks}`);
        }
    } else {
        details.push(`<strong>Little:</strong> None`);
    }

    detailsEl.innerHTML = details.join('<br>');
    
    // Attach event listeners to the links
    attachLinkListeners(detailsEl);
    
    panel.classList.add('show');
    
    // Rebuild tree to apply opacity changes when selecting a person (and nothing else is selected)
    if (!currentFamily && (!currentPledgeClass || currentPledgeClass === 'all') && pathNodes.size === 0) {
        buildTree();
    }
}

// Hide node information
function hideNodeInfo() {
    currentlySelectedNode = null;
    selectedNodeNuclearFamily.clear();
    const panel = document.getElementById('infoPanel');
    panel.classList.remove('show');
    
    // Remove highlight and restore default styling
    highlightNode(null);
    
    // Rebuild tree to update opacity when node is deselected
    if (!currentFamily && !currentPledgeClass && pathNodes.size === 0) {
        buildTree();
    }
}

// Show family information
function showFamilyInfo(familyName, memberCount) {
    const panel = document.getElementById('familyInfoPanel');
    const nameEl = document.getElementById('familyInfoName');
    const detailsEl = document.getElementById('familyInfoDetails');
    
    // Find family data
    const familyData = treeData.families?.find(f => f.name === familyName);
    const patriarch = familyData?.patriarch || 'Unknown';
    
    // Get family color scheme
    const familyColor = getFamilyColor(familyName);
    
    // Apply family colors to the panel
    panel.style.borderColor = familyColor.stroke;
    nameEl.style.color = familyColor.stroke;
    nameEl.style.borderBottom = `2px solid ${familyColor.stroke}`;
    
    // Update strong text colors in details
    const strongElements = detailsEl.querySelectorAll('strong');
    strongElements.forEach(el => {
        el.style.color = familyColor.stroke;
    });
    
    nameEl.textContent = familyName + ' Fam';
    
    let details = [];
    // Patriarch
    if (patriarch !== 'Unknown') {
        details.push(`<strong>Patriarch:</strong> ${createPersonLink(patriarch)}`);
    } else {
        details.push(`<strong>Patriarch:</strong> ${patriarch}`);
    }
    details.push(`<strong>Number of Members:</strong> ${memberCount}`);
    
    detailsEl.innerHTML = details.join('<br>');
    
    // Apply color to strong elements after setting innerHTML
    detailsEl.querySelectorAll('strong').forEach(el => {
        el.style.color = familyColor.stroke;
    });
    
    // Attach event listeners to the links
    attachLinkListeners(detailsEl);
    
    // Update info link colors to match family color
    const rgb = hexToRgb(familyColor.stroke);
    detailsEl.querySelectorAll('.info-link').forEach(link => {
        link.style.color = familyColor.stroke;
        link.style.borderColor = `rgba(${rgb}, 0.3)`;
        link.style.background = `linear-gradient(135deg, rgba(${rgb}, 0.1) 0%, rgba(${rgb}, 0.1) 100%)`;
        
        // Add hover effect
        link.addEventListener('mouseenter', function() {
            this.style.color = familyColor.stroke;
            this.style.background = `linear-gradient(135deg, rgba(${rgb}, 0.2) 0%, rgba(${rgb}, 0.2) 100%)`;
            this.style.borderColor = `rgba(${rgb}, 0.5)`;
        });
        link.addEventListener('mouseleave', function() {
            this.style.color = familyColor.stroke;
            this.style.background = `linear-gradient(135deg, rgba(${rgb}, 0.1) 0%, rgba(${rgb}, 0.1) 100%)`;
            this.style.borderColor = `rgba(${rgb}, 0.3)`;
        });
    });
    
    panel.classList.add('show');
}

// Helper function to convert hex to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? 
        `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : 
        '102, 126, 234';
}

// Hide family information
function hideFamilyInfo() {
    const panel = document.getElementById('familyInfoPanel');
    panel.classList.remove('show');
}

// Show pledge class information
function showPledgeClassInfo(pledgeClassName) {
    const panel = document.getElementById('pledgeClassInfoPanel');
    const nameEl = document.getElementById('pledgeClassInfoName');
    const detailsEl = document.getElementById('pledgeClassInfoDetails');
    
    // Find pledge class data
    const pledgeClassData = treeData.pledgeClasses?.find(pc => pc.name === pledgeClassName);
    
    if (!pledgeClassData) {
        return;
    }
    
    nameEl.textContent = pledgeClassName + ' Pledge Class';
    
    // Compute number of pledges from people who have this pledge class
    const numPledges = treeData.people?.filter(p => p.pledgeClass === pledgeClassName).length ?? 0;
    
    let details = [];
    details.push(`<strong>Semester:</strong> ${pledgeClassData.semester || 'Unknown'}`);
    details.push(`<strong>Number of Pledges:</strong> ${numPledges}`);
    
    // PCP
    if (pledgeClassData.pcp) {
        details.push(`<strong>PCP:</strong> ${createPersonLink(pledgeClassData.pcp)}`);
    } else {
        details.push(`<strong>PCP:</strong> Unknown`);
    }
    
    // PCVP
    if (pledgeClassData.pcvp) {
        details.push(`<strong>PCVP:</strong> ${createPersonLink(pledgeClassData.pcvp)}`);
    } else {
        details.push(`<strong>PCVP:</strong> Unknown`);
    }
    
    // Best Pledge
    if (pledgeClassData.bestPledge) {
        details.push(`<strong>Best Pledge:</strong> ${createPersonLink(pledgeClassData.bestPledge)}`);
    } else {
        details.push(`<strong>Best Pledge:</strong> Unknown`);
    }
    
    // Hind Tit
    if (pledgeClassData.hindTit) {
        details.push(`<strong>Hind Tit:</strong> ${createPersonLink(pledgeClassData.hindTit)}`);
    } else {
        details.push(`<strong>Hind Tit:</strong> Unknown`);
    }
    
    // Pledge Master
    if (pledgeClassData.pledgeMaster) {
        details.push(`<strong>Pledge Master:</strong> ${createPersonLink(pledgeClassData.pledgeMaster)}`);
    } else {
        details.push(`<strong>Pledge Master:</strong> Unknown`);
    }
    
    detailsEl.innerHTML = details.join('<br>');
    
    // Attach event listeners to the links
    attachLinkListeners(detailsEl);
    
    panel.classList.add('show');
}

// Hide pledge class information
function hidePledgeClassInfo() {
    const panel = document.getElementById('pledgeClassInfoPanel');
    panel.classList.remove('show');
}

// Attach event listeners to clickable links in info panels
function attachLinkListeners(container) {
    // Person links
    container.querySelectorAll('.person-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const personName = this.getAttribute('data-person');
            selectPersonByName(personName);
        });
    });
    
    // Family links
    container.querySelectorAll('.family-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const familyName = this.getAttribute('data-family');
            selectFamily(familyName);
        });
    });
    
    // Pledge class links
    container.querySelectorAll('.pledge-class-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const pledgeClassName = this.getAttribute('data-pledge-class');
            selectPledgeClass(pledgeClassName);
        });
    });
}

// Highlight a node
function highlightNode(nodeId) {
    // Remove selected class and styling from all nodes
    g.selectAll('.node').each(function(d) {
        const node = d3.select(this);
        node.classed('selected', false);
        const rect = node.select('rect');
        const text = node.select('text');
        
        let fillColor;
        // Restore appropriate styling based on node type
        if (pathNodes.has(d.id)) {
            // Keep path node styling
            fillColor = '#ff6b6b';
            rect.style('fill', fillColor);
            rect.style('stroke', '#c92a2a');
            rect.style('stroke-width', '5px');
        } else if (pledgeClassNodes.has(d.id)) {
            // Keep pledge class node styling
            fillColor = '#ffd700';
            rect.style('fill', fillColor);
            rect.style('stroke', '#ff8c00');
            rect.style('stroke-width', '5px');
        } else {
            // Family-based styling (gradient for two families)
            fillColor = getNodeFill(d, 'normal');
            const primaryColor = getFamilyColor(d.family);
            rect.style('fill', fillColor);
            rect.style('stroke', primaryColor.stroke);
            rect.style('stroke-width', '3px');
        }
        // Update text color for readability (use primary fill when gradient)
        const bgForContrast = (d.families && d.families.length >= 2) ? getFamilyColor(d.family).fill : fillColor;
        text.style('fill', getContrastingTextColor(typeof bgForContrast === 'string' && bgForContrast.startsWith('url(') ? getFamilyColor(d.family).fill : bgForContrast));
    });
    
    // If nodeId is provided, add selected class and styling to that node
    if (nodeId) {
        g.selectAll('.node').filter(d => d.id === nodeId).each(function() {
            const node = d3.select(this);
            node.classed('selected', true);
            const rect = node.select('rect');
            const text = node.select('text');
            // Apply selected styling (purple/blue color) - this overrides other styles
            const fillColor = '#629dc7';
            rect.style('fill', fillColor);
            rect.style('stroke', '#764ba2');
            rect.style('stroke-width', '4px');
            // Update text color for readability
            text.style('fill', getContrastingTextColor(fillColor));
        });
    }
}

// Find shortest path between two people
function findPath() {
    // Get actual names from data attributes if available, otherwise extract from input value
    const person1Input = document.getElementById('person1');
    const person2Input = document.getElementById('person2');
    const person1 = person1Input.getAttribute('data-actual-name') || extractActualName(person1Input.value);
    const person2 = person2Input.getAttribute('data-actual-name') || extractActualName(person2Input.value);

    if (!person1 || !person2) {
        alert('Please enter both names');
        return;
    }

    // Check if names exist in data
    const allNames = new Set(treeData.people.map(p => p.name));
    if (!allNames.has(person1)) {
        alert(`"${person1}" not found in the data. Please check the spelling.`);
        return;
    }
    if (!allNames.has(person2)) {
        alert(`"${person2}" not found in the data. Please check the spelling.`);
        return;
    }

    // Build adjacency list from person bigs and littles
    const adjacencyList = new Map();
    
    treeData.people.forEach(person => {
        const connections = [];
        // Add littles as connections
        if (person.littles) {
            person.littles.forEach(little => connections.push(little));
        }
        // Add bigs as connections
        if (person.bigs) {
            person.bigs.forEach(big => connections.push(big));
        }
        adjacencyList.set(person.name, connections);
    });

    // BFS to find shortest path
    const queue = [[person1]];
    const visited = new Set([person1]);

    while (queue.length > 0) {
        const path = queue.shift();
        const current = path[path.length - 1];

        if (current === person2) {
            // Found path!
            currentPath = path;
            pathNodes.clear();
            pathLinks.clear();
            
            path.forEach(name => pathNodes.add(name));
            
            for (let i = 0; i < path.length - 1; i++) {
                pathLinks.add(`${path[i]}-${path[i + 1]}`);
            }

            // Show path in side panel
            showPathPanel(path);
            
            // Hide family legend when path is shown
            const legend = document.getElementById('familyLegend');
            if (legend) legend.style.display = 'none';
            
            // Rebuild tree to show path (preserve path highlighting)
            buildTree(true);
            
            // Zoom to path after tree is rendered
            setTimeout(() => {
                zoomToPath(path);
                highlightPathindree();
            }, 300);
            
            return;
        }

        const neighbors = adjacencyList.get(current) || [];
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push([...path, neighbor]);
            }
        }
    }

    // No path found
    currentPath = null;
    hidePathPanel();
    showErrorPopup(`No path found between ${person1} and ${person2}`);
}

// Zoom to show the path
function zoomToPath(path) {
    const nodes = g.selectAll('.node').data();
    const pathNodeData = nodes.filter(d => path.includes(d.id));
    
    if (pathNodeData.length === 0) return;

    // Get path panel dimensions to account for it in zoom calculations
    const pathPanel = document.getElementById('pathPanel');
    let panelWidth = 400; // Default based on max-width CSS
    let panelHeight = 200; // Estimated default height
    const panelPadding = 20; // Padding around panel (matches CSS right/bottom: 20px)
    
    if (pathPanel) {
        // Panel should already be visible when zoomToPath is called, but check anyway
        if (pathPanel.classList.contains('show')) {
            const rect = pathPanel.getBoundingClientRect();
            if (rect.width > 0) panelWidth = rect.width;
            if (rect.height > 0) panelHeight = rect.height;
        }
        // If not visible, use CSS defaults (max-width: 400px, min-width: 300px)
        // We'll use 400px as a safe estimate
    }

    const xCoords = pathNodeData.map(d => d.x);
    const yCoords = pathNodeData.map(d => d.y);
    
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const spanX = maxX - minX || width;
    const spanY = maxY - minY || height;
    
    // Account for path panel in available space
    // Panel is in lower right (bottom: 20px, right: 20px)
    // So we need to reduce available width and height
    const availableWidth = width - (panelWidth + panelPadding * 2);
    const availableHeight = height - (panelHeight + panelPadding * 2);
    
    // Calculate scale based on available space (with some padding)
    const scaleX = availableWidth / spanX;
    const scaleY = availableHeight / spanY;
    let scale = Math.min(scaleX, scaleY) * 0.8;
    // Enforce minimum scale so long paths don't zoom out too much
    const pathSpan = Math.max(spanX, spanY);
    const minPathPixels = Math.min(availableWidth, availableHeight) * 0.9;
    const minScaleFromView = pathSpan > 0 ? minPathPixels / pathSpan : scale;
    const absoluteMinScale = 0.55; // Never zoom out past this (path stays readable)
    scale = Math.max(absoluteMinScale, Math.max(minScaleFromView, scale));
    
    // Center the path in the viewport
    const transform = d3.zoomIdentity
        .translate(width / 2 - centerX * scale, height / 2 - centerY * scale)
        .scale(scale);
    
    svg.transition()
        .duration(750)
        .call(zoom.transform, transform);
}

// Clear path highlighting (keeps input values)
function clearPathDisplay() {
    if (currentPath !== null) {
        pathNodes.clear();
        pathLinks.clear();
        currentPath = null;
        hidePathPanel();
        
        // Show family legend when path is cleared (unless pledge class is selected)
        const pledgeClassFilter = document.getElementById('pledgeClassFilter');
        if (!pledgeClassFilter || pledgeClassFilter.value === 'all') {
            const legend = document.getElementById('familyLegend');
            if (legend) legend.style.display = 'block';
        }
        
        buildTree();
        // Reset zoom/pan to fit-all view like Reset
        setTimeout(() => zoomToFitAllNodes(), 100);
    }
}

// Clear path highlighting and input fields
function clearPath() {
    pathNodes.clear();
    pathLinks.clear();
    currentPath = null;
    const person1Input = document.getElementById('person1');
    const person2Input = document.getElementById('person2');
    person1Input.value = '';
    person2Input.value = '';
    person1Input.removeAttribute('data-actual-name');
    person2Input.removeAttribute('data-actual-name');
    hidePathPanel();
    
    // Show family legend when path is cleared (unless pledge class is selected)
    const pledgeClassFilter = document.getElementById('pledgeClassFilter');
    if (!pledgeClassFilter || pledgeClassFilter.value === 'all') {
        const legend = document.getElementById('familyLegend');
        if (legend) legend.style.display = 'block';
    }
    
    buildTree();
    // Reset zoom/pan to fit-all view like Reset
    setTimeout(() => zoomToFitAllNodes(), 100);
}

// Show path panel with text description
function showPathPanel(path) {
    const panel = document.getElementById('pathPanel');
    const pathText = document.getElementById('pathText');
    
    if (path.length < 2) {
        hidePathPanel();
        return;
    }
    
    // Build path description with clickable links
    let pathDescription = `Path from ${createPersonLink(path[0])} to ${createPersonLink(path[path.length - 1])}:\n\n`;
    
    for (let i = 0; i < path.length - 1; i++) {
        const current = path[i];
        const next = path[i + 1];
        
        // Determine relationship direction by checking person's bigs and littles
        const currentPerson = treeData.people.find(p => p.name === current);
        const nextPerson = treeData.people.find(p => p.name === next);
        
        if (currentPerson && nextPerson) {
            const isCurrentBig = currentPerson.littles && currentPerson.littles.includes(next);
            const isCurrentLittle = currentPerson.bigs && currentPerson.bigs.includes(next);
            
            if (isCurrentBig) {
                pathDescription += `${i + 1}. ${createPersonLink(current)}'s little is ${createPersonLink(next)}\n`;
            } else if (isCurrentLittle) {
                pathDescription += `${i + 1}. ${createPersonLink(current)}'s big is ${createPersonLink(next)}\n`;
            } else {
                pathDescription += `${i + 1}. ${createPersonLink(current)} → ${createPersonLink(next)}\n`;
            }
        } else {
            pathDescription += `${i + 1}. ${createPersonLink(current)} → ${createPersonLink(next)}\n`;
        }
    }
    
    pathDescription += `\nTotal steps: ${path.length - 1}`;
    
    // Use innerHTML instead of textContent to support links
    pathText.innerHTML = pathDescription.replace(/\n/g, '<br>');
    
    // Attach event listeners to the links
    attachLinkListeners(pathText);
    
    panel.classList.add('show');
}

// Hide path panel
function hidePathPanel() {
    const panel = document.getElementById('pathPanel');
    panel.classList.remove('show');
}

// Show error popup
function showErrorPopup(message) {
    const popup = document.getElementById('errorPopup');
    const overlay = document.getElementById('errorPopupOverlay');
    const content = document.getElementById('errorPopupContent');
    
    content.textContent = message;
    popup.classList.add('show');
    overlay.classList.add('show');
}

// Hide error popup
function hideErrorPopup() {
    const popup = document.getElementById('errorPopup');
    const overlay = document.getElementById('errorPopupOverlay');
    
    popup.classList.remove('show');
    overlay.classList.remove('show');
}

// Highlight path in the tree after rendering
function highlightPathindree() {
    // Force update node and link styles with transition
    g.selectAll('.node').each(function(d) {
        const node = d3.select(this);
        if (pathNodes.has(d.id)) {
            const rect = node.select('rect');
            const text = node.select('text');
            const textNode = text.node();
            if (textNode) {
                const textWidth = textNode.getBBox().width || d.name.length * 7;
                const baseWidth = textWidth + 20;
                const baseHeight = 24;
                const fillColor = '#ff6b6b';
                rect
                    .transition()
                    .duration(300)
                    .style('fill', fillColor)
                    .style('stroke', '#c92a2a')
                    .style('stroke-width', '5px')
                    .attr('width', baseWidth + 4)
                    .attr('height', baseHeight + 2)
                    .attr('x', -(baseWidth + 4) / 2)
                    .attr('y', -(baseHeight + 2) / 2);
                // Update text color for readability
                text
                    .transition()
                    .duration(300)
                    .style('fill', getContrastingTextColor(fillColor));
            }
        }
    });
    
    g.selectAll('.link').each(function(d) {
        const link = d3.select(this);
        const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
        const targetId = typeof d.target === 'object' ? d.target.id : d.target;
        if (pathLinks.has(`${sourceId}-${targetId}`) || 
            pathLinks.has(`${targetId}-${sourceId}`)) {
            link
                .transition()
                .duration(300)
                .attr('stroke', '#ff6b6b')
                .attr('stroke-width', 4)
                .classed('path-link', true);
        }
    });
}

// Populate family filter dropdown
function populateFamilyFilter() {
    const filter = document.getElementById('familyFilter');
    const families = new Set();
    
    treeData.people.forEach(person => {
        if (Array.isArray(person.families)) {
            person.families.forEach(f => families.add(f));
        }
    });
    
    families.forEach(family => {
        const option = document.createElement('option');
        option.value = family;
        option.textContent = family;
        filter.appendChild(option);
    });
    
    // Setup filtered autocomplete for path finder inputs
    setupFilteredAutocomplete('person1');
    setupFilteredAutocomplete('person2');
    // Search person: same dropdown, and on select immediately select that person in the tree
    setupFilteredAutocomplete('personSearch', (name) => selectPersonByName(name));
}

// Populate pledge class filter dropdown
function populatePledgeClassFilter() {
    const filter = document.getElementById('pledgeClassFilter');
    
    if (!treeData.pledgeClasses || treeData.pledgeClasses.length === 0) {
        return;
    }
    
    treeData.pledgeClasses.forEach(pledgeClass => {
        const option = document.createElement('option');
        option.value = pledgeClass.name;
        option.textContent = pledgeClass.name;
        filter.appendChild(option);
    });
}

// Toggle family legend collapsed state (collapse to small tab / expand from tab)
function toggleFamilyLegendCollapse() {
    const legend = document.getElementById('familyLegend');
    if (!legend) return;
    legend.classList.toggle('family-legend-collapsed');
}

// Populate family legend
function populateFamilyLegend() {
    const legendContainer = document.getElementById('legendItems');
    if (!legendContainer) return;
    
    // Clear existing items
    legendContainer.innerHTML = '';
    
    // Get all unique families (from family and families)
    const families = new Set();
    treeData.people.forEach(person => {
        if (Array.isArray(person.families)) {
            person.families.forEach(f => families.add(f));
        }
    });
    
    // Sort families alphabetically
    const sortedFamilies = Array.from(families).sort();
    
    // Create legend items
    sortedFamilies.forEach(familyName => {
        const familyColor = getFamilyColor(familyName);
        
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        legendItem.onclick = function() {
            // Set the family filter dropdown to this family
            const familyFilter = document.getElementById('familyFilter');
            if (familyFilter) {
                familyFilter.value = familyName;
                familyFilter.dispatchEvent(new Event('change'));
            }
        };
        
        const colorBox = document.createElement('div');
        colorBox.className = 'legend-color-box';
        colorBox.style.backgroundColor = familyColor.fill;
        colorBox.style.borderColor = familyColor.stroke;
        
        const label = document.createElement('span');
        label.className = 'legend-item-label';
        label.textContent = familyName;
        
        legendItem.appendChild(colorBox);
        legendItem.appendChild(label);
        legendContainer.appendChild(legendItem);
    });
}

// Setup filtered autocomplete for input fields
// onSelectCallback(name): optional, called when user picks a person (e.g. to select that person in the tree)
function setupFilteredAutocomplete(inputId, onSelectCallback) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    // Get all person names
    const allNames = treeData.people.map(person => person.name).sort();
    
    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.id = `${inputId}-dropdown`;
    dropdown.className = 'autocomplete-dropdown';
    
    // Create a wrapper for the input to position the dropdown correctly
    const inputWrapper = document.createElement('div');
    inputWrapper.style.position = 'relative';
    inputWrapper.style.display = 'inline-block';
    
    // Insert wrapper before input and move input into it
    input.parentNode.insertBefore(inputWrapper, input);
    inputWrapper.appendChild(input);
    inputWrapper.appendChild(dropdown);
    
    let selectedIndex = -1;
    let filteredNames = [];
    
    function applySelection(name) {
        input.setAttribute('data-actual-name', name);
        input.value = formatNameWithNickname(name);
        dropdown.classList.remove('show');
        selectedIndex = -1;
        if (typeof onSelectCallback === 'function') {
            onSelectCallback(name);
        }
    }
    
    // Function to filter and show dropdown
    function showDropdown(query) {
        if (!query || query.trim() === '') {
            dropdown.classList.remove('show');
            return;
        }
        
        const queryLower = query.toLowerCase().trim();
        // Filter by name, formatted name with nickname, and nickname directly.
        // Redacted persons only match when the user types "redacted".
        filteredNames = allNames.filter(name => {
            const person = treeData.people.find(p => p.name === name);
            if (person?.redacted) {
                return queryLower.includes('redacted');
            }
            const nameLower = name.toLowerCase();
            const formattedName = formatNameWithNickname(name);
            const formattedNameLower = formattedName.toLowerCase();
            const nicknameLower = person?.nickname?.toLowerCase() || '';
            return nameLower.includes(queryLower) ||
                   formattedNameLower.includes(queryLower) ||
                   nicknameLower.includes(queryLower);
        });
        
        if (filteredNames.length === 0) {
            dropdown.classList.remove('show');
            return;
        }
        
        // Limit to 10 results for better UX
        filteredNames = filteredNames.slice(0, 10);
        
        // Clear and populate dropdown
        dropdown.innerHTML = '';
        filteredNames.forEach((name, index) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            // Display name with nickname in dropdown
            item.textContent = formatNameWithNickname(name);
            item.addEventListener('click', () => {
                applySelection(name);
            });
            dropdown.appendChild(item);
        });
        
        dropdown.classList.add('show');
        selectedIndex = -1;
    }
    
    // Function to hide dropdown
    function hideDropdown() {
        dropdown.classList.remove('show');
        selectedIndex = -1;
    }
    
    // Function to highlight item
    function highlightItem(index) {
        const items = dropdown.querySelectorAll('.autocomplete-item');
        items.forEach((item, i) => {
            if (i === index) {
                item.classList.add('highlighted');
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } else {
                item.classList.remove('highlighted');
            }
        });
    }
    
    // Input event - show filtered dropdown
    input.addEventListener('input', (e) => {
        showDropdown(e.target.value);
    });
    
    // Focus event - show dropdown if there's text
    input.addEventListener('focus', (e) => {
        if (e.target.value.trim() !== '') {
            showDropdown(e.target.value);
        }
    });
    
    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.autocomplete-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length > 0) {
                selectedIndex = (selectedIndex + 1) % items.length;
                highlightItem(selectedIndex);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length > 0) {
                selectedIndex = selectedIndex <= 0 ? items.length - 1 : selectedIndex - 1;
                highlightItem(selectedIndex);
            }
        } else if (e.key === 'Enter') {
            if (selectedIndex >= 0 && selectedIndex < items.length) {
                e.preventDefault();
                e.stopImmediatePropagation();
                applySelection(filteredNames[selectedIndex]);
            }
        } else if (e.key === 'Escape') {
            hideDropdown();
        }
    });
    
    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            hideDropdown();
        }
    });
    
    // Hide dropdown when input loses focus (with small delay to allow clicks)
    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (!dropdown.matches(':hover') && document.activeElement !== input) {
                hideDropdown();
            }
        }, 200);
    });
}

// Zoom to a specific family's bounding box
function zoomToFamily(familyName) {
    // Get all nodes from the rendered tree
    const allNodes = g.selectAll('.node').data();
    
    // Find nodes belonging to this family
    const familyNodes = allNodes.filter(d => d.families && d.families.includes(familyName));
    
    if (familyNodes.length === 0) {
        console.log('No nodes found for family:', familyName);
        return;
    }
    
    // Calculate bounding box
    const xCoords = familyNodes.map(d => d.x);
    const yCoords = familyNodes.map(d => d.y);
    
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const spanX = maxX - minX || width;
    const spanY = maxY - minY || height;
    
    // Add padding around the family
    const padding = 100;
    const scale = Math.min(width / (spanX + padding * 2), height / (spanY + padding * 2)) * 0.9;
    
    // Create transform to center and zoom to family
    const transform = d3.zoomIdentity
        .translate(width / 2 - centerX * scale, height / 2 - centerY * scale)
        .scale(scale);
    
    // Animate the zoom/pan
    svg.transition()
        .duration(750)
        .call(zoom.transform, transform);
}

// Zoom to family when clicking on family label (doesn't change filter)
function toggleFamilyFilter(familyName) {
    // Just zoom to the family, don't change the dropdown filter
    zoomToFamily(familyName);
}

// Update center button visibility based on filter state
function updateCenterButtonVisibility() {
    const familyFilter = document.getElementById('familyFilter').value;
    const pledgeClassFilter = document.getElementById('pledgeClassFilter').value;
    const centerButton = document.getElementById('centerButton');
    
    // Show center button if any filter is active
    if (familyFilter !== 'all' || pledgeClassFilter !== 'all') {
        centerButton.style.display = 'inline-block';
    } else {
        centerButton.style.display = 'none';
    }
}

// Filter by family when using dropdown
document.getElementById('familyFilter').addEventListener('change', function() {
    const selectedFamily = this.value;
    currentFamily = selectedFamily;
    
    // Close node info panel when selecting a family filter
    hideNodeInfo();
    
    // Clear pledge class filter if family filter is being set
    if (selectedFamily !== 'all') {
        const pledgeClassFilter = document.getElementById('pledgeClassFilter');
        if (pledgeClassFilter && pledgeClassFilter.value !== 'all') {
            pledgeClassFilter.value = 'all';
            // Clear pledge class highlighting
            pledgeClassNodes.clear();
            pledgeClassNuclearFamily.clear();
            currentPledgeClass = null;
            hidePledgeClassInfo();
        }
    }
    
    if (selectedFamily === 'all') {
        // Clear family highlighting
        familyNodes.clear();
        familyNuclearFamily.clear();
        hideFamilyInfo();
        // Show family legend when no family is selected (unless pledge class is selected)
        const pledgeClassFilter = document.getElementById('pledgeClassFilter');
        if (!pledgeClassFilter || pledgeClassFilter.value === 'all') {
            const legend = document.getElementById('familyLegend');
            if (legend) legend.style.display = 'block';
        }
        buildTree();
    } else {
        // Show family legend when a family is selected
        const legend = document.getElementById('familyLegend');
        if (legend) legend.style.display = 'block';
        // Find all people in this family
        familyNodes.clear();
        familyNuclearFamily.clear();
        
        treeData.people.forEach(person => {
            if (Array.isArray(person.families) && person.families.includes(selectedFamily)) {
                familyNodes.add(person.name);
            }
        });
        
        // Find nuclear family (bigs and littles) of family members
        treeData.people.forEach(person => {
            if (familyNodes.has(person.name)) {
                // Add this person's littles to nuclear family
                if (person.littles) {
                    person.littles.forEach(little => familyNuclearFamily.add(little));
                }
                // Add this person's bigs to nuclear family
                if (person.bigs) {
                    person.bigs.forEach(big => familyNuclearFamily.add(big));
                }
            }
        });
        
        // Show family info panel
        showFamilyInfo(selectedFamily, familyNodes.size);
        
        // Rebuild tree with highlighting (don't animate to ensure highlighting is visible)
        buildTree(false, false);
        
        // Zoom to family nodes after tree is rendered and ensure highlighting is applied
        setTimeout(() => {
            highlightFamilyInTree();
            zoomToFamily(selectedFamily);
        }, 350);
    }
    updateCenterButtonVisibility();
});

// Filter by pledge class when using dropdown
document.getElementById('pledgeClassFilter').addEventListener('change', function() {
    const selectedPledgeClass = this.value;
    currentPledgeClass = selectedPledgeClass;
    
    // Close node info panel when selecting a pledge class filter
    hideNodeInfo();
    
    // Clear family filter if pledge class filter is being set
    if (selectedPledgeClass !== 'all') {
        const familyFilter = document.getElementById('familyFilter');
        if (familyFilter && familyFilter.value !== 'all') {
            familyFilter.value = 'all';
            // Clear family highlighting
            familyNodes.clear();
            familyNuclearFamily.clear();
            currentFamily = null;
            hideFamilyInfo();
        }
    }
    
    if (selectedPledgeClass === 'all') {
        // Clear pledge class highlighting
        pledgeClassNodes.clear();
        pledgeClassNuclearFamily.clear();
        hidePledgeClassInfo();
        // Show family legend when pledge class is cleared
        const legend = document.getElementById('familyLegend');
        if (legend) legend.style.display = 'block';
        buildTree();
    } else {
        // Hide family legend when pledge class is selected
        const legend = document.getElementById('familyLegend');
        if (legend) legend.style.display = 'none';
        // Find all people in this pledge class
        pledgeClassNodes.clear();
        pledgeClassNuclearFamily.clear();
        
        treeData.people.forEach(person => {
            if (person.pledgeClass === selectedPledgeClass) {
                pledgeClassNodes.add(person.name);
            }
        });
        
        // Find nuclear family (bigs and littles) of pledge class members
        treeData.people.forEach(person => {
            if (pledgeClassNodes.has(person.name)) {
                // Add this person's littles to nuclear family
                if (person.littles) {
                    person.littles.forEach(little => pledgeClassNuclearFamily.add(little));
                }
                // Add this person's bigs to nuclear family
                if (person.bigs) {
                    person.bigs.forEach(big => pledgeClassNuclearFamily.add(big));
                }
            }
        });
        
        // Show pledge class info
        showPledgeClassInfo(selectedPledgeClass);
        
        // Rebuild tree with highlighting (don't animate to ensure highlighting is visible)
        buildTree(false, false);
        
        // Zoom to pledge class nodes after tree is rendered and ensure highlighting is applied
        // Use a longer delay to ensure layout is complete
        setTimeout(() => {
            // Force update highlighting in case initial render didn't catch it
            highlightPledgeClassInTree();
            zoomToPledgeClass(selectedPledgeClass);
        }, 350);
    }
    updateCenterButtonVisibility();
});

// Zoom controls
function zoomIn() {
    svg.transition().call(zoom.scaleBy, 1.5);
}

function zoomOut() {
    svg.transition().call(zoom.scaleBy, 1 / 1.5);
}

function resetZoom() {
    svg.transition().call(zoom.transform, d3.zoomIdentity);
}

function centerTree() {
    const nodes = g.selectAll('.node').data();
    if (nodes.length === 0) return;
    
    const xCoords = nodes.map(d => d.x);
    const yCoords = nodes.map(d => d.y);
    
    const centerX = (Math.min(...xCoords) + Math.max(...xCoords)) / 2;
    const centerY = (Math.min(...yCoords) + Math.max(...yCoords)) / 2;
    
    const transform = d3.zoomIdentity
        .translate(width / 2 - centerX, height / 2 - centerY);
    
    svg.transition()
        .duration(750)
        .call(zoom.transform, transform);
}

// Center view: same zoom/pan as when the active filter was first applied
function centerView() {
    if (currentPledgeClass && currentPledgeClass !== 'all') {
        zoomToPledgeClass(currentPledgeClass);
        return;
    }
    if (currentFamily && currentFamily !== 'all') {
        zoomToFamily(currentFamily);
        return;
    }
    // Fallback when Center is shown but state is unclear (e.g. during init)
    const nodes = g.selectAll('.node').data();
    if (nodes.length === 0) {
        resetZoom();
        return;
    }
    const validNodes = nodes.filter(d => d.x !== undefined && d.y !== undefined && !isNaN(d.x) && !isNaN(d.y));
    if (validNodes.length === 0) {
        resetZoom();
        return;
    }
    const xCoords = validNodes.map(d => d.x);
    const yCoords = validNodes.map(d => d.y);
    const centerX = (Math.min(...xCoords) + Math.max(...xCoords)) / 2;
    const centerY = (Math.min(...yCoords) + Math.max(...yCoords)) / 2;
    const transform = d3.zoomIdentity
        .translate(width / 2 - centerX, height / 2 - centerY);
    svg.transition()
        .duration(750)
        .call(zoom.transform, transform);
}

// Zoom to show all pledge class nodes
function zoomToPledgeClass(pledgeClassName) {
    // Get all nodes and their data
    const nodeSelection = g.selectAll('.node');
    const allNodes = nodeSelection.data();
    
    // Filter for pledge class nodes and extract their coordinates
    const pledgeClassNodeData = [];
    nodeSelection.each(function(d) {
        if (pledgeClassNodes.has(d.id)) {
            // Get coordinates from data (set by force simulation)
            if (d.x !== undefined && d.y !== undefined && !isNaN(d.x) && !isNaN(d.y)) {
                pledgeClassNodeData.push({ x: d.x, y: d.y });
            } else {
                // Fallback: parse from transform attribute
                const transform = d3.select(this).attr('transform');
                if (transform) {
                    const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
                    if (match) {
                        const x = parseFloat(match[1]);
                        const y = parseFloat(match[2]);
                        if (!isNaN(x) && !isNaN(y)) {
                            pledgeClassNodeData.push({ x, y });
                        }
                    }
                }
            }
        }
    });
    
    if (pledgeClassNodeData.length === 0) {
        console.log('No visible pledge class nodes found for:', pledgeClassName);
        return;
    }

    // Extract coordinates
    const xCoords = pledgeClassNodeData.map(d => d.x);
    const yCoords = pledgeClassNodeData.map(d => d.y);
    
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const spanX = maxX - minX || width;
    const spanY = maxY - minY || height;
    
    // Add padding around the pledge class nodes
    const padding = 100;
    const scale = Math.min(width / (spanX + padding * 2), height / (spanY + padding * 2)) * 0.9;
    
    // Ensure scale is valid and reasonable
    if (isNaN(scale) || scale <= 0 || !isFinite(scale) || scale > 10) {
        console.log('Invalid scale calculated:', scale, 'spanX:', spanX, 'spanY:', spanY);
        return;
    }
    
    const transform = d3.zoomIdentity
        .translate(width / 2 - centerX * scale, height / 2 - centerY * scale)
        .scale(scale);
    
    svg.transition()
        .duration(750)
        .call(zoom.transform, transform);
}

// Zoom and center to a specific node
function zoomToNode(node) {
    if (!node) return;
    
    // Get node coordinates
    let nodeX = node.x;
    let nodeY = node.y;
    
    // If coordinates are not available in data, try to get from DOM
    if (nodeX === undefined || nodeY === undefined || isNaN(nodeX) || isNaN(nodeY)) {
        const nodeElement = g.selectAll('.node').filter(d => d.id === node.id);
        if (nodeElement.size() > 0) {
            const transform = nodeElement.attr('transform');
            if (transform) {
                const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
                if (match) {
                    nodeX = parseFloat(match[1]);
                    nodeY = parseFloat(match[2]);
                }
            }
        }
    }
    
    // If still no valid coordinates, return
    if (nodeX === undefined || nodeY === undefined || isNaN(nodeX) || isNaN(nodeY)) {
        console.log('No valid coordinates found for node:', node.id);
        return;
    }
    
    // Center on the node with a subtle zoom level
    const scale = 1.2; // Slight zoom in (1.2x)
    const transform = d3.zoomIdentity
        .translate(width / 2 - nodeX * scale, height / 2 - nodeY * scale)
        .scale(scale);
    
    svg.transition()
        .duration(750)
        .call(zoom.transform, transform);
}

// Highlight pledge class nodes in the tree after rendering
function highlightPledgeClassInTree() {
    // Force update node styles - check both by id and by name to be safe
    g.selectAll('.node').each(function(d) {
        const node = d3.select(this);
        const nodeId = d.id || d.name;
        const label = node.select('.node-label');
        
        // Check if this node should be highlighted for pledge class
        if (pledgeClassNodes.has(nodeId) && !pathNodes.has(nodeId)) {
            const rect = node.select('rect');
            const text = node.select('text');
            if (rect.size() > 0 && text.size() > 0) {
                const textNode = text.node();
                if (textNode) {
                    const textWidth = textNode.getBBox().width || d.name.length * 7;
                    const baseWidth = textWidth + 20;
                    const baseHeight = 24;
                    const fillColor = '#ffd700'; // Gold
                    // Apply highlighting immediately using style() to override CSS
                    rect
                        .style('fill', fillColor)
                        .style('stroke', '#ff8c00') // Orange
                        .style('stroke-width', '6px') // Moderately thicker stroke
                        .attr('width', baseWidth + 6)
                        .attr('height', baseHeight + 3)
                        .attr('x', -(baseWidth + 6) / 2)
                        .attr('y', -(baseHeight + 3) / 2);
                    // Update text color for readability
                    text.style('fill', getContrastingTextColor(fillColor));
                }
            }
            // Ensure full opacity for pledge class nodes
            node.style('opacity', 1);
            if (label.size() > 0) {
                label
                    .style('opacity', 1)
                    .style('font-weight', '700');
            }
        } else if (!pledgeClassNodes.has(nodeId) && !pathNodes.has(nodeId)) {
            // Ensure non-highlighted nodes have family-based styling
            const rect = node.select('rect');
            const text = node.select('text');
            if (rect.size() > 0 && text.size() > 0) {
                const textNode = text.node();
                if (textNode) {
                    const textWidth = textNode.getBBox().width || d.name.length * 7;
                    const baseWidth = textWidth + 20;
                    const baseHeight = 24;
                    const familyColor = getFamilyColor(d.family);
                    const fillColor = familyColor.fill;
                    rect
                        .style('fill', fillColor)
                        .style('stroke', familyColor.stroke)
                        .style('stroke-width', '3px')
                        .attr('width', baseWidth)
                        .attr('height', baseHeight)
                        .attr('x', -baseWidth / 2)
                        .attr('y', -baseHeight / 2);
                    // Update text color for readability
                    text.style('fill', getContrastingTextColor(fillColor));
                }
            }
            // Fade non-pledge-class nodes if a pledge class is selected
            if (currentPledgeClass && currentPledgeClass !== 'all') {
                // Nuclear family members (bigs/littles) should be less faded
                if (pledgeClassNuclearFamily.has(nodeId)) {
                    node.style('opacity', 0.6);
                    if (label.size() > 0) {
                        label.style('opacity', 0.6);
                    }
                } else {
                    node.style('opacity', 0.15);
                    if (label.size() > 0) {
                        label.style('opacity', 0.15);
                    }
                }
            } else {
                node.style('opacity', 1);
                if (label.size() > 0) {
                    label.style('opacity', 1);
                }
            }
        }
    });
    
    // Also update link opacity
    if (currentPledgeClass && currentPledgeClass !== 'all') {
        g.selectAll('.link').each(function(d) {
            const link = d3.select(this);
            const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
            const targetId = typeof d.target === 'object' ? d.target.id : d.target;
            const sourceInPledgeClass = pledgeClassNodes.has(sourceId);
            const targetInPledgeClass = pledgeClassNodes.has(targetId);
            const sourceInNuclearFamily = pledgeClassNuclearFamily.has(sourceId);
            const targetInNuclearFamily = pledgeClassNuclearFamily.has(targetId);
            
            // Full opacity only for:
            // 1. Edges between pledge class nodes and nuclear family
            // 2. Edges between nuclear family members
            // All other edges (including edges from nuclear family to outside) are faded
            if ((sourceInPledgeClass && targetInNuclearFamily) || 
                (targetInPledgeClass && sourceInNuclearFamily) ||
                (sourceInNuclearFamily && targetInNuclearFamily)) {
                link.style('opacity', 1); // Full opacity
            } else {
                link.style('opacity', 0.15); // Very faded for other links
            }
        });
    }
}

// Highlight family nodes in the tree after rendering
function highlightFamilyInTree() {
    // Force update node styles - check both by id and by name to be safe
    g.selectAll('.node').each(function(d) {
        const node = d3.select(this);
        const nodeId = d.id || d.name;
        const label = node.select('.node-label');
        
        // Check if this node should be highlighted for family
        if (familyNodes.has(nodeId) && !pathNodes.has(nodeId)) {
            const rect = node.select('rect');
            const text = node.select('text');
            if (rect.size() > 0 && text.size() > 0) {
                const textNode = text.node();
                if (textNode) {
                    const textWidth = textNode.getBBox().width || d.name.length * 7;
                    const baseWidth = textWidth + 20;
                    const baseHeight = 24;
                    const fillColor = getNodeFill(d, 'normal'); // Gradient for two families
                    const primaryColor = getFamilyColor(d.family);
                    // Apply highlighting immediately using style() to override CSS
                    rect
                        .style('fill', fillColor)
                        .style('stroke', primaryColor.stroke)
                        .style('stroke-width', '6px') // Moderately thicker stroke
                        .attr('width', baseWidth + 6)
                        .attr('height', baseHeight + 3)
                        .attr('x', -(baseWidth + 6) / 2)
                        .attr('y', -(baseHeight + 3) / 2);
                    const bgForContrast = (d.families && d.families.length >= 2) ? primaryColor.fill : fillColor;
                    text.style('fill', getContrastingTextColor(typeof bgForContrast === 'string' && bgForContrast.startsWith('url(') ? primaryColor.fill : bgForContrast));
                }
            }
            // Ensure full opacity for family nodes
            node.style('opacity', 1);
            if (label.size() > 0) {
                label
                    .style('opacity', 1)
                    .style('font-weight', '700');
            }
        } else if (!familyNodes.has(nodeId) && !pathNodes.has(nodeId)) {
            // Ensure non-highlighted nodes have family-based styling (gradient for two families)
            const rect = node.select('rect');
            const text = node.select('text');
            if (rect.size() > 0 && text.size() > 0) {
                const textNode = text.node();
                if (textNode) {
                    const textWidth = textNode.getBBox().width || d.name.length * 7;
                    const baseWidth = textWidth + 20;
                    const baseHeight = 24;
                    const fillColor = getNodeFill(d, 'normal');
                    const primaryColor = getFamilyColor(d.family);
                    rect
                        .style('fill', fillColor)
                        .style('stroke', primaryColor.stroke)
                        .style('stroke-width', '3px')
                        .attr('width', baseWidth)
                        .attr('height', baseHeight)
                        .attr('x', -baseWidth / 2)
                        .attr('y', -baseHeight / 2);
                    const bgForContrast = (d.families && d.families.length >= 2) ? primaryColor.fill : fillColor;
                    text.style('fill', getContrastingTextColor(typeof bgForContrast === 'string' && bgForContrast.startsWith('url(') ? primaryColor.fill : bgForContrast));
                }
            }
            // Fade non-family nodes if a family is selected
            if (currentFamily && currentFamily !== 'all') {
                // Nuclear family members (bigs/littles) should be less faded
                if (familyNuclearFamily.has(nodeId)) {
                    node.style('opacity', 0.6);
                    if (label.size() > 0) {
                        label.style('opacity', 0.6);
                    }
                } else {
                    node.style('opacity', 0.15);
                    if (label.size() > 0) {
                        label.style('opacity', 0.15);
                    }
                }
            } else {
                node.style('opacity', 1);
                if (label.size() > 0) {
                    label.style('opacity', 1);
                }
            }
        }
    });
    
    // Also update link opacity
    if (currentFamily && currentFamily !== 'all') {
        g.selectAll('.link').each(function(d) {
            const link = d3.select(this);
            const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
            const targetId = typeof d.target === 'object' ? d.target.id : d.target;
            const sourceInFamily = familyNodes.has(sourceId);
            const targetInFamily = familyNodes.has(targetId);
            const sourceInNuclearFamily = familyNuclearFamily.has(sourceId);
            const targetInNuclearFamily = familyNuclearFamily.has(targetId);
            
            // Full opacity only for:
            // 1. Edges between family nodes and nuclear family
            // 2. Edges between nuclear family members
            // All other edges (including edges from nuclear family to outside) are faded
            if ((sourceInFamily && targetInNuclearFamily) || 
                (targetInFamily && sourceInNuclearFamily) ||
                (sourceInNuclearFamily && targetInNuclearFamily)) {
                link.style('opacity', 1); // Full opacity
            } else {
                link.style('opacity', 0.15); // Very faded for other links
            }
        });
    }
}

// Zoom to fit all visible nodes in the viewport
function zoomToFitAllNodes(animate = true) {
    const nodes = g.selectAll('.node').data();
    if (nodes.length === 0) {
        resetZoom();
        return;
    }
    
    // Filter out nodes with invalid coordinates
    const validNodes = nodes.filter(d => d.x !== undefined && d.y !== undefined && !isNaN(d.x) && !isNaN(d.y));
    
    if (validNodes.length === 0) {
        resetZoom();
        return;
    }
    
    // Calculate bounding box
    const xCoords = validNodes.map(d => d.x);
    const yCoords = validNodes.map(d => d.y);
    
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const spanX = maxX - minX || width;
    const spanY = maxY - minY || height;
    
    // Add padding around the entire tree
    const padding = 150;
    const scale = Math.min(width / (spanX + padding * 2), height / (spanY + padding * 2)) * 0.85;
    
    // Ensure scale is valid and reasonable
    const finalScale = isNaN(scale) || scale <= 0 || !isFinite(scale) || scale > 10 ? 1 : scale;
    
    // Create transform to center and zoom to fit all nodes
    const transform = d3.zoomIdentity
        .translate(width / 2 - centerX * finalScale, height / 2 - centerY * finalScale)
        .scale(finalScale);
    
    if (animate) {
        svg.transition()
            .duration(750)
            .call(zoom.transform, transform);
    } else {
        // Apply immediately without animation
        svg.call(zoom.transform, transform);
    }
}

// Reset view: centers the tree and resets zoom
function resetView() {
    // Close all popup windows
    hideNodeInfo();
    hideFamilyInfo();
    hidePledgeClassInfo();
    
    // Clear path and path input fields
    pathNodes.clear();
    pathLinks.clear();
    currentPath = null;
    const person1Input = document.getElementById('person1');
    const person2Input = document.getElementById('person2');
    if (person1Input) {
        person1Input.value = '';
        person1Input.removeAttribute('data-actual-name');
    }
    if (person2Input) {
        person2Input.value = '';
        person2Input.removeAttribute('data-actual-name');
    }
    hidePathPanel();
    
    // Reset filters
    document.getElementById('familyFilter').value = 'all';
    document.getElementById('pledgeClassFilter').value = 'all';
    pledgeClassNodes.clear();
    pledgeClassNuclearFamily.clear();
    currentPledgeClass = null;
    familyNodes.clear();
    familyNuclearFamily.clear();
    currentFamily = null;
    
    // Show family legend when resetting (all filters cleared)
    const legend = document.getElementById('familyLegend');
    if (legend) legend.style.display = 'block';
    
    // Rebuild tree to clear highlighting first
    buildTree();
    
    // Wait for tree to be rendered, then calculate zoom to fit all nodes
    setTimeout(() => {
        zoomToFitAllNodes();
        // Update center button visibility (should hide since filters are cleared)
        updateCenterButtonVisibility();
    }, 100);
}

// Initialize on load
window.addEventListener('load', init);

