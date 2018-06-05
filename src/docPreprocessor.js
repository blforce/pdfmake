"use strict";

var isString = require("./helpers").isString;
var isNumber = require("./helpers").isNumber;
var isBoolean = require("./helpers").isBoolean;
var isArray = require("./helpers").isArray;
var isUndefined = require("./helpers").isUndefined;
var fontStringify = require("./helpers").fontStringify;
var mysql = require("mysql");
var stream = require("stream");

function DocPreprocessor() {}

DocPreprocessor.prototype.preprocessDocument = async function(docStructure) {
	this.tocs = [];
	this.nodeReferences = [];
	return await this.preprocessNode(docStructure);
};

DocPreprocessor.prototype.preprocessNode = async function(node) {
	// expand shortcuts and casting values
	if (isArray(node)) {
		node = { stack: node };
	} else if (isString(node)) {
		node = { text: node };
	} else if (isNumber(node) || isBoolean(node)) {
		node = { text: node.toString() };
	} else if (node === undefined || node === null) {
		node = { text: "" };
	} else if (Object.keys(node).length === 0) {
		// empty object
		node = { text: "" };
	} else if (
		"text" in node &&
		(node.text === undefined || node.text === null)
	) {
		node.text = "";
	}

	if (node.columns) {
		return await this.preprocessColumns(node);
	} else if (node.stack) {
		return await this.preprocessVerticalContainer(node);
	} else if (node.ul) {
		return await this.preprocessList(node);
	} else if (node.ol) {
		return await this.preprocessList(node);
	} else if (node.table) {
		return await this.preprocessTable(node);
	} else if (node.text !== undefined) {
		return await this.preprocessText(node);
	} else if (node.toc) {
		return await this.preprocessToc(node);
	} else if (node.image) {
		return this.preprocessImage(node);
	} else if (node.canvas) {
		return this.preprocessCanvas(node);
	} else if (node.qr) {
		return this.preprocessQr(node);
	} else if (node.pageReference || node.textReference) {
		return await this.preprocessText(node);
	} else {
		throw "Unrecognized document structure: " +
			JSON.stringify(node, fontStringify);
	}
};

DocPreprocessor.prototype.preprocessColumns = async function(node) {
	var columns = node.columns;

	for (var i = 0, l = columns.length; i < l; i++) {
		columns[i] = await this.preprocessNode(columns[i]);
	}

	return node;
};

DocPreprocessor.prototype.preprocessVerticalContainer = async function(node) {
	var items = node.stack;

	for (var i = 0, l = items.length; i < l; i++) {
		items[i] = await this.preprocessNode(items[i]);
	}

	return node;
};

DocPreprocessor.prototype.preprocessList = async function(node) {
	var items = node.ul || node.ol;

	for (var i = 0, l = items.length; i < l; i++) {
		items[i] = await this.preprocessNode(items[i]);
	}

	return node;
};

DocPreprocessor.prototype.preprocessTable = async function(node) {
	var col, row, cols, rows;

	for (col = 0, cols = node.table.body[0].length; col < cols; col++) {
		for (row = 0, rows = node.table.body.length; row < rows; row++) {
			var rowData = node.table.body[row];
			var data = rowData[col];
			if (data !== undefined) {
				if (data === null) {
					// transform to object
					data = "";
				}
				if (!data._span) {
					rowData[col] = await this.preprocessNode(data);
				}
			}
		}
	}

	return node;
};

DocPreprocessor.prototype.fillTableData = function(node) {
	return new Promise((resolve, reject) => {
		var connection = mysql.createConnection(node.data.connection);
		var columns = node.data.columns;
		var layoutBuilder = this;

		connection.connect(err => {
			if (err) {
				reject(err);
			} else {
				connection
					.query(node.data.query)
					.stream()
					.pipe(
						stream.Transform({
							objectMode: true,
							transform: function(data, encoding, callback) {
								var row = [];
								for (var i = 0; i < columns.length; i++) {
									var column = columns[i];

									if (column.hasOwnProperty("text")) {
										var newColumn = JSON.parse(JSON.stringify(column));
										newColumn.text = data[newColumn.text];
									} else {
										newColumn = data[column];
									}
									row.push(newColumn);
								}

								node.table.body.push(row);
								callback();
							}
						})
					)
					.on("finish", () => {
						delete node.data;
						resolve();
					});
			}
		});
	});
};

DocPreprocessor.prototype.preprocessText = async function(node) {
	if (node.tocItem) {
		if (!isArray(node.tocItem)) {
			node.tocItem = [node.tocItem];
		}

		for (var i = 0, l = node.tocItem.length; i < l; i++) {
			if (!isString(node.tocItem[i])) {
				node.tocItem[i] = "_default_";
			}

			var tocItemId = node.tocItem[i];

			if (!this.tocs[tocItemId]) {
				this.tocs[tocItemId] = { toc: { _items: [], _pseudo: true } };
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
			this.nodeReferences[node.id] = { _nodeRef: node };
		}
	}

	if (node.pageReference) {
		if (!this.nodeReferences[node.pageReference]) {
			this.nodeReferences[node.pageReference] = { _nodeRef: {}, _pseudo: true };
		}
		node.text = "00000";
		node._pageRef = this.nodeReferences[node.pageReference];
	}

	if (node.textReference) {
		if (!this.nodeReferences[node.textReference]) {
			this.nodeReferences[node.textReference] = { _nodeRef: {}, _pseudo: true };
		}

		node.text = "";
		node._textRef = this.nodeReferences[node.textReference];
	}

	if (node.text && node.text.text) {
		node.text = [await this.preprocessNode(node.text)];
	}

	return node;
};

DocPreprocessor.prototype.preprocessToc = async function(node) {
	if (!node.toc.id) {
		node.toc.id = "_default_";
	}

	node.toc.title = node.toc.title
		? await this.preprocessNode(node.toc.title)
		: null;
	node.toc._items = [];

	if (this.tocs[node.toc.id]) {
		if (!this.tocs[node.toc.id].toc._pseudo) {
			throw "TOC '" + node.toc.id + "' already exists";
		}

		node.toc._items = this.tocs[node.toc.id].toc._items;
	}

	this.tocs[node.toc.id] = node;

	return node;
};

DocPreprocessor.prototype.preprocessImage = function(node) {
	if (
		!isUndefined(node.image.type) &&
		!isUndefined(node.image.data) &&
		node.image.type === "Buffer" &&
		isArray(node.image.data)
	) {
		node.image = Buffer.from(node.image.data);
	}
	return node;
};

DocPreprocessor.prototype.preprocessCanvas = function(node) {
	return node;
};

DocPreprocessor.prototype.preprocessQr = function(node) {
	return node;
};

module.exports = DocPreprocessor;
