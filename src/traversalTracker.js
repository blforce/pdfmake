"use strict";

function TraversalTracker() {
	this.events = {};
}

TraversalTracker.prototype.startTracking = function (event, callback) {
	var callbacks = this.events[event] || (this.events[event] = []);

	if (callbacks.indexOf(callback) < 0) {
		callbacks.push(callback);
	}
};

TraversalTracker.prototype.stopTracking = function (event, callback) {
	var callbacks = this.events[event];

	if (!callbacks) {
		return;
	}

	var index = callbacks.indexOf(callback);
	if (index >= 0) {
		callbacks.splice(index, 1);
	}
};

TraversalTracker.prototype.emit = async function (event) {
	var args = Array.prototype.slice.call(arguments, 1);
	var callbacks = this.events[event];

	if (!callbacks) {
		return;
	}

	for (let callback of callbacks) {
		if (callback instanceof Promise) {
			await callback.apply(this, args);
		} else {
			callback.apply(this, args);
		}
	}
};

TraversalTracker.prototype.auto = async function (
	event,
	callback,
	innerFunction
) {

	this.startTracking(event, callback);

	if (innerFunction instanceof Promise || innerFunction.constructor.name === 'AsyncFunction') {
		await innerFunction();
	} else {
		innerFunction();
	}

	this.stopTracking(event, callback);
};

module.exports = TraversalTracker;
