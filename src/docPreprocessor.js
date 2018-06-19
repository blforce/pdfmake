'use strict';

var isString = require('./helpers').isString;
var isNumber = require('./helpers').isNumber;
var isBoolean = require('./helpers').isBoolean;
var isArray = require('./helpers').isArray;
var isUndefined = require('./helpers').isUndefined;
var fontStringify = require('./helpers').fontStringify;

function DocPreprocessor() {

}

DocPreprocessor.prototype.preprocessDocument = function (docStructure) {
	this.tocs = [];
	this.nodeReferences = [];
	return this.preprocessNode(docStructure);
};

DocPreprocessor.prototype.preprocessNode = function (node) {
	// expand shortcuts and casting values
	if (isArray(node)) {
		node = {stack: node};
	} else if (isString(node)) {
		node = {text: node};
	} else if (isNumber(node) || isBoolean(node)) {
		node = {text: node.toString()};
	} else if (node === undefined || node === null) {
		node = {text: ''};
	} else if (Object.keys(node).length === 0) { // empty object
		node = {text: ''};
	} else if ('text' in node && (node.text === undefined || node.text === null)) {
		node.text = '';
	}

	if (node.outline !== undefined) {
		this.preprocessOutline(node);
	}

	if (node.columns) {
		return this.preprocessColumns(node);
	} else if (node.columnCount) {
		return this.preprocessWrapper(node);
	} else if (node.stack) {
		return this.preprocessVerticalContainer(node);
	} else if (node.ul) {
		return this.preprocessList(node);
	} else if (node.ol) {
		return this.preprocessList(node);
	} else if (node.table) {
		return this.preprocessTable(node);
	} else if (node.text !== undefined) {
		return this.preprocessText(node);
	} else if (node.toc) {
		return this.preprocessToc(node);
	} else if (node.image) {
		return this.preprocessImage(node);
	} else if (node.canvas) {
		return this.preprocessCanvas(node);
	} else if (node.qr) {
		return this.preprocessQr(node);
	} else if (node.pageReference || node.textReference) {
		return this.preprocessText(node);
	} else {
		throw 'Unrecognized document structure: ' + JSON.stringify(node, fontStringify);
	}
};

DocPreprocessor.prototype.preprocessOutline = function (node) {
	var outline = node.outline;

	if (isNumber(outline)) {
		outline = {
			level: outline
		};
	}

	if (node.text && outline.text === undefined) {
		outline.text = node.text;
	}

	node._outline = outline;
};

DocPreprocessor.prototype.preprocessWrapper = function (node) {
	var content = node.content;

	for (var i = 0, l = content.length; i < l; i++) {
		content[i] = this.preprocessNode(content[i]);
	}

	return node;
};

DocPreprocessor.prototype.preprocessColumns = function (node) {
	var columns = node.columns;

	for (var i = 0, l = columns.length; i < l; i++) {
		columns[i] = this.preprocessNode(columns[i]);
	}

	return node;
};

DocPreprocessor.prototype.preprocessVerticalContainer = function (node) {
	var items = node.stack;

	for (var i = 0, l = items.length; i < l; i++) {
		items[i] = this.preprocessNode(items[i]);
	}

	return node;
};

DocPreprocessor.prototype.preprocessList = function (node) {
	var items = node.ul || node.ol;

	for (var i = 0, l = items.length; i < l; i++) {
		items[i] = this.preprocessNode(items[i]);
	}

	return node;
};

DocPreprocessor.prototype.preprocessTable = function (node) {
	var col, row, cols, rows;

	for (col = 0, cols = node.table.body[0].length; col < cols; col++) {
		for (row = 0, rows = node.table.body.length; row < rows; row++) {
			var rowData = node.table.body[row];
			var data = rowData[col];
			if (data !== undefined) {
				if (data === null) { // transform to object
					data = '';
				}
				if (!data._span) {
					rowData[col] = this.preprocessNode(data);
				}
			}
		}
	}

	return node;
};

DocPreprocessor.prototype.preprocessText = function (node) {
	if (node.tocItem) {
		if (!isArray(node.tocItem)) {
			node.tocItem = [node.tocItem];
		}

		for (var i = 0, l = node.tocItem.length; i < l; i++) {
			if (!isString(node.tocItem[i])) {
				node.tocItem[i] = '_default_';
			}

			var tocItemId = node.tocItem[i];

			if (!this.tocs[tocItemId]) {
				this.tocs[tocItemId] = {toc: {_items: [], _pseudo: true}};
			}

			this.tocs[tocItemId].toc._items.push(node);
		}
	}

	if (node.id) {
		if (this.nodeReferences[node.id]) {
			if (!this.nodeReferences[node.id]._pseudo) {
				throw "Node id '" + node.id + "' already exists";
			}

			this.nodeReferences[node.id]._nodeRef = node;
			this.nodeReferences[node.id]._pseudo = false;
		} else {
			this.nodeReferences[node.id] = {_nodeRef: node};
		}
	}

	if (node.pageReference) {
		if (!this.nodeReferences[node.pageReference]) {
			this.nodeReferences[node.pageReference] = {_nodeRef: {}, _pseudo: true};
		}
		node.text = '00000';
		node._pageRef = this.nodeReferences[node.pageReference];
	}

	if (node.textReference) {
		if (!this.nodeReferences[node.textReference]) {
			this.nodeReferences[node.textReference] = {_nodeRef: {}, _pseudo: true};
		}

		node.text = '';
		node._textRef = this.nodeReferences[node.textReference];
	}

	if (node.text && node.text.text) {
		node.text = [this.preprocessNode(node.text)];
	}

	return node;
};

function compareItem(a, b) {
	if (a.text < b.text) {
		return -1;
	}

	if (a.text > b.text) {
		return 1;
	}

	return 0;
}

function insertHeaders(items) {
	// Add number header if needed
	var firstChar = items[0].text.substring(0, 1);
	var lastSection;

	if (!isNaN(firstChar)) {
		items.unshift({
			text: '0-9',
			isHeader: true
		});
		lastSection = 'numeric';
	}

	var idx = 0;

	while (idx < items.length) {
		firstChar = items[idx].text.substring(0, 1);

		if (lastSection === 'numeric' && !isNaN(firstChar)) {
			idx++;
			continue;
		}

		if (firstChar !== lastSection) {
			if (idx > 0) {
				var previousItem = items[idx - 1];
				var prevMargin = previousItem.tocMargin;

				if (prevMargin) {
					prevMargin[3] = 16;
				} else {
					previousItem.tocMargin = [0, 0, 0, 16]
				}
			}
			lastSection = firstChar;
			items.splice(idx, 0, {
				text: firstChar.toUpperCase(),
				isHeader: true
			});
			idx++;
		}

		idx++;
	}
};

DocPreprocessor.prototype.preprocessToc = function (node) {
	if (!node.toc.id) {
		node.toc.id = '_default_';
	}

	node.toc.title = node.toc.title ? this.preprocessNode(node.toc.title) : null;
	node.toc._items = [];

	if (this.tocs[node.toc.id]) {
		if (!this.tocs[node.toc.id].toc._pseudo) {
			throw "TOC '" + node.toc.id + "' already exists";
		}

		node.toc._items = this.tocs[node.toc.id].toc._items;

		node.toc._items.sort(compareItem);

		// TODO: Combine similar items

		if (node.toc.showSectionHeaders) {
			insertHeaders(node.toc._items);
		}
	}

	this.tocs[node.toc.id] = node;

	return node;
};

DocPreprocessor.prototype.preprocessImage = function (node) {
	if (!isUndefined(node.image.type) && !isUndefined(node.image.data) && (node.image.type === 'Buffer') && isArray(node.image.data)) {
		node.image = Buffer.from(node.image.data);
	}
	return node;
};

DocPreprocessor.prototype.preprocessCanvas = function (node) {
	return node;
};

DocPreprocessor.prototype.preprocessQr = function (node) {
	return node;
};

module.exports = DocPreprocessor;