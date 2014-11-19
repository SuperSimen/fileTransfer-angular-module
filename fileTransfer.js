(function() {
	var fileTransfer = angular.module('fileTransfer', []);

	fileTransfer.run(function(fileSender, fileReceiver) {
		fileSender.init();
		fileReceiver.init();
	});

	fileTransfer.factory('fileTransfer', function(messageHandlers, fileSender, fileReceiver, fileList, utility) {

		var fileTransfer = {
			file: null,
			debug: false
		};

		fileTransfer.loadFile = function(file) {
			fileTransfer.file = file;
		};

		fileTransfer.newTransfer = function() {

			function reply (type) {
				return function(data) {
					var message = {
						data: data,
						type: type,
					};

					if (transfer.sender) {
						transfer.sender(message);
					}
					else {
						console.error('sender not configured');
					}
				};
			}

			var transfer = {
				sender: null,
				setSender: function(sender) {
					this.sender = sender;
				},
				onmessage: function(message) {
					var data = message.data;

					if (fileTransfer.debug) {
						console.log(message);
					}

					if (message.type && messageHandlers.list[message.type]) {
						var messageHandler = messageHandlers.list[message.type];
						messageHandler.handler(data, reply(messageHandler.type));
						return;
					}
					else {
						console.log("hot message");
						console.log(event.data);
					}
				},
				sendFile: function(file) {
					if (!this.sender) {
						console.error('sender not configured');
					}
					if (!file) {
						file = fileTransfer.file;
					}

					var id = file.name + "-" + utility.randomString();
					var fileModel = fileList.add(id, file.name, true, file.size);

					fileSender.sendFile(file, fileModel, reply('fileSender'));
				},
			};

			return transfer;
		};

		return fileTransfer;
	});

	fileTransfer.factory('messageHandlers', function() {
		var messageHandlers = {
			list: {},
			addHandler: function(handler, targetType, originType) {
				if (this.list[targetType]) {
					console.error ('handler already exists');
				}
				else {
					this.list[targetType] = {
						handler: handler,
						type: originType,
					};
				}
			}
		};

		return messageHandlers;
	});

	fileTransfer.factory('utility', function() {
		return {
			randomString: function() {
				return Math.random().toString(32).substring(2);
			}

		};
	});

	fileTransfer.directive('ftFileUploader', function(fileTransfer) {
		return function(scope, element, attr) {
			element.on('change', function() {
				fileTransfer.loadFile(element[0].files[0]);
			});
		};
	});

	fileTransfer.factory('fileList', function() {
		fileList = {
			list: {},
			add: function(id, filename, sending, size) {
				if (this.list[id]) {
					return console.log("id not unique");
				}
				this.list[id] = {
					id: id,
					filename: filename,
					sending: sending,
					progress: 0,
					finished: false,
					accepted: true, //set false to not accept automatically
					cancelled: false,
					acceptPossible: function() {
						return !this.accepted && !this.cancelled && !this.sending;
					},
					cancelPossible: function() {
						if (!this.cancelled) {
							if (this.sending) {
								if (!this.finished) {
									return true;
								}
							}
							else {
								if (this.accepted) {
									return !this.finished;
								}
								else {
									return true;
								}
							}
						}
						return false;
					},
					accept: function() {
						this.accepted = true;
					},
					cancel: function() {
						this.cancelled = true;
					},
					size: size,
				};

				return this.list[id];
			},
			get: function(id) {
				if (!this.list[id]) {
					console.log("file id does not exist");
				}
				return this.list[id];
			},
		};

		return fileList;
	});

	fileTransfer.factory('fileReceiver', function($rootScope, utility, fileList, $window, messageHandlers) {
		var fileReceiver = {
			init: function() {
				messageHandlers.addHandler(fileHandler, "fileSender", "fileReceiver");
				prepareSandbox();
			}
		};

		var storage = {};

		function cleanUp(id) {
			delete storage[id];
		}

		function fileHandler(data, sender) {

			if (data.status === "sof") {

				storage[data.id] = {};
				storage[data.id].sender = {send: sender};

				$rootScope.$apply(function() {
					storage[data.id].fileObject = fileList.add(data.id, data.filename, false, data.size);

					var cancelWatcher = $rootScope.$watch(function() {
						if (storage[data.id]) {
							return storage[data.id].fileObject.cancelled;
						}
					}, function (newValue) {
						if (newValue) {
							signalFile(data.id, "cancel");
							delete storage[data.id];

							cancelWatcher();
						}
					});
				});

				if (fileList.writeFailed) {
					$rootScope.$apply(function() {
						fileList.get(data.id).writeFailed = true;
						fileList.get(data.id).cancel();
					});
					return;
				}

				initiateFileSystem(data.id, data.filename, data.size, data.totalSlices, function() {
					storage[data.id].filename = data.filename;
					storage[data.id].counter = 0;
					storage[data.id].eof = false;
					storage[data.id].totalSlices = data.totalSlices;
					storage[data.id].totalNumbers = [];
					storage[data.id].getTotalNumber = function() {
						var total = 0;
						for (var i = 1; i < this.totalNumbers.length; i++) {
							total += this.totalNumbers[i];
						}
						return total;
					};
					storage[data.id].slices = [];



					signalFile(data.id, "sof_ack", data.totalSlices, data.filename);
				});

			}
			else if (storage[data.id]) {
				if (data.status === "sos") {
					storage[data.id].slices[data.slice] = {
						totalChunks: data.totalNumber,
						counter: 0,
						eos: false,
						chunks: [],
						getByteArray: function() {
							var byteArrays = [];
							for (var i in this.chunks) {
								for (var j in this.chunks[i]) {
									var temp = this.chunks[i][j];
									if (!temp) {
										return console.error("Panic! missing chunk");
									}
									byteArrays.push(this.chunks[i][j]);
								}
							}
							return byteArrays;
						}
					};

					storage[data.id].totalNumbers[data.slice] = data.totalNumber;
					signalSlice(data.id, "sos_ack", data.slice, data.totalSlices, data.totalNumber, data.filename);
				}
				else if (data.status === "ongoing") {
					if (!storage[data.id].sliceSize) storage[data.id].sliceSize = data.totalNumber;

					if (data.number % 25 === 0) {
						var progress = (storage[data.id].counter / (storage[data.id].totalSlices * storage[data.id].sliceSize)) * 100;

						$rootScope.$apply(function() {
							fileList.list[data.id].progress = progress;
						});
					}

					storage[data.id].counter++;
					storage[data.id].slices[data.slice].counter++;
					var byteArrays = base64toByteArrays(data.base64);

					if (storage[data.id].slices[data.slice].chunks[data.number]) {
						console.error("same chunk twice");
					}
					storage[data.id].slices[data.slice].chunks[data.number] = byteArrays;
				}
				else if (data.status === "eos") {
					if (storage[data.id].slices) {
						storage[data.id].slices[data.slice].eos = true;
					}
					else {
						console.error("This should not have happened. Deleted data before completing");
						console.log(storage);
						console.log(data);
					}
				}
				else if (data.status === "eof") {
					storage[data.id].eof = true;
				}
				else if (data.status === "cancel") {
					$rootScope.$apply(function() {
						storage[data.id].fileObject.cancel();
						return;
					});
				}
				else {
					console.log("You should not see this. Status: " + data.status);
				}

				if (storage[data.id] && storage[data.id].slices[data.slice] &&
					storage[data.id].slices[data.slice].eos &&
						storage[data.id].slices[data.slice].counter ===
							storage[data.id].slices[data.slice].totalChunks) {


					var byteArraysForCompleteSlice = storage[data.id].slices[data.slice].getByteArray();
					var blob = new Blob(byteArraysForCompleteSlice, {type: "application/octet-stream"});

					delete storage[data.id].slices[data.slice];

					if (data.slice === data.totalSlices) {
						sandbox[data.id].appendBlob(blob, true);
						storage[data.id].receivedEntireFile = true;
					}
					else {
						sandbox[data.id].appendBlob(blob, false);
					}
					signalSlice(data.id, "eos_ack", data.slice, data.totalSlices, data.totalNumber, data.filename);
				}

				if (storage[data.id] && storage[data.id].eof &&
					storage[data.id].counter === storage[data.id].getTotalNumber() &&
						storage[data.id].receivedEntireFile) {

					$rootScope.$apply(function() {
					});
					signalFile(data.id, "eof_ack", data.totalSlices, data.filename);


					cleanUp(data.id);
				}
			}
			else {
			}

		}


		function signalFile(id, status, totalSlices, filename) {
			var tempFile = {
				id: id,
				status: status,
				filename: filename,
				totalSlices: totalSlices
			};
			if (storage[id].sender) {
				storage[id].sender.send(tempFile, true);
			}
			else {
				console.error("no sender");
			}
		}

		function signalSlice(id, status, slice, totalSlices, totalNumber, filename) {
			var tempFile = {
				id: id,
				slice: slice,
				status: status,
				totalNumber: totalNumber,
				totalSlices: totalSlices,
				filename: filename
			};
			if (storage[id].sender) {
				storage[id].sender.send(tempFile, true);
			}
			else {
				console.error("no sender");
			}
		}


		function base64toByteArrays(b64Data) {
			var sliceSize = 512;

			var byteCharacters = atob(b64Data);
			var byteArrays = [];

			for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
				var slice = byteCharacters.slice(offset, offset + sliceSize);

				var byteNumbers = new Array(slice.length);
				for (var i = 0; i < slice.length; i++) {
					byteNumbers[i] = slice.charCodeAt(i);
				}

				var byteArray = new Uint8Array(byteNumbers);

				byteArrays.push(byteArray);
			}
			return byteArrays;
		}


		function prepareSandbox() {
			$window.webkitRequestFileSystem(window.TEMPORARY, 0, onInit, errorHandler);

			function onInit(fs) {
				function readEntries () {
					var dirReader = fs.root.createReader();
					dirReader.readEntries (function(results) {
						console.log(results);
					}, errorHandler);
				}

				function deleteDirectory(directory) {
					fs.root.getDirectory(directory, {}, function(dirEntry) {
						dirEntry.removeRecursively(function() {
						}, errorHandler);
					}, null); 
				}

				function readDirectory(directory) {
					fs.root.getDirectory(directory, {}, function(dirEntry) {
						var dirReader = dirEntry.createReader();
						dirReader.readEntries(function(results) {
							console.log(results);
						}, errorHandler);
					}, errorHandler); 
				}
				deleteDirectory("files");
			}
		}

		function initiateFileSystem(id, filename, fileSize, totalSlices, callback) {
			if (false) {
				navigator.webkitPersistentStorage.requestQuota(fileSize + 1024*10, function(grantedBytes) {
					console.log("granted bytes " + grantedBytes);
					window.webkitRequestFileSystem(window.PERSISTENT, grantedBytes, onInitFs(id, filename, totalSlices, callback), errorHandler);
				}, errorHandler);
			}
			else {
				window.webkitRequestFileSystem(window.TEMPORARY, fileSize, onInitFs(id, filename, totalSlices, callback), errorHandler);
			}
		}

		var sandbox = {
			counter: 0
		};
		function onInitFs(id, filenameInput, totalSlices, callback) {
			return function(fs) {
				var filename = "files/" + filenameInput + "-" + utility.randomString() + "-" + sandbox.counter++;

				continueFileInit(1);

				function continueFileInit(part) {
					if (part === 1) {
						fs.root.getFile(filename, {create: false}, function(fileEntryInput) {
							fileEntryInput.remove(function() {
							}, errorHandler);

							continueFileInit(2);
						}, function() {
							continueFileInit(2);
						});
					}
					if (part === 2) {
						fs.root.getDirectory('files', {create: true}, function(dirEntry) {
							continueFileInit(3);
						}, errorHandler);
					}
					if (part === 3) {
						fs.root.getFile(filename, {create: true}, function(fileEntryInput) {
							continueFileInit(4);
						}, errorHandler);
					}
					if (part === 4) {
						sandbox[id] = {
							appendBlob: function(blob, lastBlob) {
								fs.root.getFile(filename, {create: false}, function(fileEntry) {
									fileEntry.createWriter(function(fileWriter) {
										fileWriter.onwriteend = function(e) {
											if (lastBlob) {

												var watcher = $rootScope.$watch(function() {return fileList.list[id].accepted;}, function(newValue) {
													if (newValue) {
														sandbox[id].downloadFile();
														watcher();
													}
												});

												$rootScope.$apply(function() {
													fileList.list[id].finished = true;
												});
											}
										};
										fileWriter.onerror = function(e) {
											console.log('Write failed: ' + e.toString());
											console.error(e);
										};
										fileWriter.seek(fileWriter.length);
										fileWriter.write(blob);

									}, errorHandler);
								}, errorHandler);
							},
							downloadFile: function() {
								fs.root.getFile(filename, {create: false}, function(fileEntry) {
									fileEntry.file(function(file) {
										var link = document.createElement('a');
										link.href = window.URL.createObjectURL(file);
										link.download = filenameInput;
										link.click();

									}, errorHandler);
								});
							},
						};
						callback();
					}
				}
			};
		}

		function errorHandler(e) {
			fileList.writeFailed = true;
		}

		return fileReceiver;
	});

	fileTransfer.factory('fileSender', function($rootScope, messageHandlers, fileList) {
		var fileSender = {
			init: function() {
				messageHandlers.addHandler(dataHandlers.main, "fileReceiver", 'fileSender');
			}
		};

		var dataHandlers = {
			list: {},
			main: function(data) {
				if (data.id && dataHandlers.list[data.id]) {
					dataHandlers.list[data.id](data);
				}
				else {
					console.log("hot data");
					console.log(data);
				}
			},

			add: function(handler, id) {
				if (dataHandlers.list[id]) {
					return console.error("handler id exists");
				}
				dataHandlers.list[id] = handler;
			},
			remove: function(id) {
				if (dataHandlers.list[id]) {
					delete dataHandlers.list[id];
				}
			}
		};


		fileSender.sendFile = function(file, fileModel, sender) {
			sendFile(file, fileModel, sender);
		};


		function sendFile (file, fileModel, send) {

			var sender = {send: send};

			if (!file) {
				return console.log("wrong input to sendFile");
			}
			var progress = {
				counter: 0,
				calculate: function() {
					if (this.totalSlices && this.sliceSize) {
						return (this.counter / (this.totalSlices * this.sliceSize)) * 100;
					}
					return false;
				}
			};

			var size = file.size;
			var maxSize = 100*1024*1024;
			var totalSlices = Math.ceil(size / maxSize);

			var id = fileModel.id;

			progress.totalSlices = totalSlices;

			function isCancelled() {
				return fileModel.cancelled;
			}

			var watcher = $rootScope.$watch(function() {return fileModel.cancelled;}, function (newValue) {
				if (newValue) {
					signalCancel(id);

					watcher();
				}
			});

			dataHandlers.add(fileHandler, id);
			var listOfCallbacks = [];

			function fileHandler(data) {
				if (data.status === "sof_ack") {
					if (continueFileSending) {
						continueFileSending();
					}
					else {
						console.error("ack without file sender");
					}
				}
				else if (data.status === "sos_ack") {
					if (listOfCallbacks[data.slice]) {
						listOfCallbacks[data.slice]();
						delete listOfCallbacks[data.slice];
					}
					else {
						console.error("ack without file sender");
					}
				}
				else if (data.status === "eof_ack") {
					$rootScope.$apply(function() {
						fileList.list[id].finished = true;
					});
					dataHandlers.remove(id);
				}
				else if (data.status === "cancel") {
					$rootScope.$apply(function() {
						fileModel.cancel();
					});
				}
			}

			signalFile(id, "sof", totalSlices, file.name, size);

			function continueFileSending () {
				if (size < maxSize) {
					read(file, 1, eof);
				}
				else {
					senderLoop(0)();
				}
			}

			var sliceCounter = 1;

			function senderLoop(i) {
				return function () {
					if (isCancelled()) {
						return;
					}

					var blob;
					if (i + maxSize > size) {
						blob = file.slice(i, size);
						read(blob, sliceCounter++, eof);
					}
					else {
						blob = file.slice(i, i + maxSize);
						read(blob, sliceCounter++, senderLoop(i+maxSize));
					}

				};
			}

			function eof() {
				signalFile(id, "eof", totalSlices, file.name);

			}

			function read(blob, slice, callback) {
				var reader = new FileReader();

				reader.onerror = function(event) {
					console.error("File could not be read! Code " + event.target.error.code);
				};

				reader.onload = function(event) {
					var buffer = event.target.result;

					var array = btoa(buffer).match(/.{1,51200}/g);
					if (!progress.sliceSize) progress.sliceSize = array.length;


					listOfCallbacks[slice] = function() {
						for (var i in array) {
							if (isCancelled()) {
								return;
							}

							sendFileChunk(id, array[i], "ongoing", slice, totalSlices, i, array.length, file.name);
						}
						signalSlice(id, "eos", slice, totalSlices, array.length, file.name);
						if (callback) callback();
					};

					signalSlice(id, "sos", slice, totalSlices, array.length, file.name);
				};
				reader.readAsBinaryString(blob);
			}


			function sendFileChunk(id, chunk, status, slice, totalSlices, number, totalNumber, filename) {
				var tempFile = {
					id: id,
					base64: chunk,
					size: chunk.length,
					status: status,
					number: number,
					totalNumber: totalNumber,
					filename: filename,
					slice: slice,
					totalSlices: totalSlices
				};
				sender.send(tempFile);
			}

			function signalCancel(id) {
				sender.send({
					id: id,
					status: "cancel",
				}, true);
			}

			function signalFile(id, status, totalSlices, filename, size) {
				var tempFile = {
					id: id,
					status: status,
					filename: filename,
					totalSlices: totalSlices,
					size: size
				};
				sender.send(tempFile);
			}

			function signalSlice(id, status, slice, totalSlices, totalNumber, filename) {
				var tempFile = {
					id: id,
					slice: slice,
					status: status,
					totalNumber: totalNumber,
					totalSlices: totalSlices,
					filename: filename
				};
				sender.send(tempFile);
			}
		}

		return fileSender;
	});
})();
