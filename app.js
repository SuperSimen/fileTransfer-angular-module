(function() {
	var app = angular.module('app', ['fileTransfer']);

	(function() {
		'use strict';

		app.controller('appController', function (fileTransfer, $scope) {
			var transfer = fileTransfer.newTransfer();

			transfer.setSender(function(data) {
				transfer.onmessage(data);
			});

			$scope.sendFile = function () {
				transfer.sendFile();
			};
		});

	})();
})();
