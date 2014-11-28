(function() {
	var app = angular.module('app', ['fileTransfer']);

	(function() {
		'use strict';

		app.controller('appController', function (fileTransfer, $scope, fileList) {

			var transfer = fileTransfer.newTransfer();

			transfer.setSender(function(data, callback) {
				//send file to yourself. Super useful
				transfer.onmessage(data);

				if (callback) {
					callback('sent');
				}
			});

			$scope.sendFile = function () {
				transfer.sendFile();
			};

			$scope.fileList = fileList.list;

		});

	})();
})();
