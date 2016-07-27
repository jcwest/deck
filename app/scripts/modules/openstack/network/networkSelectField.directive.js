'use strict';

let angular = require('angular');

module.exports = angular.module('spinnaker.openstack.network.networkSelectField.directive', [
  require('../../core/utils/lodash'),
  require('../../core/network/network.read.service.js'),
  require('../common/selectField.component.js')
])
  .directive('networkSelectField', function (_, networkReader) {
    return {
      restrict: 'E',
      templateUrl: require('./networkSelectField.directive.html'),
      scope: {
        label: '@',
        labelColumnSize: '@',
        helpKey: '@',
        model: '=',
        filter: '=',
        onChange: '&',
        readOnly: '=',
        allowNoSelection: '=',
        noOptionsMessage: '@',
        noSelectionMessage: '@'
      },
      link: function(scope) {
        _.defaults(scope, {
          label: 'Network',
          labelColumnSize: 3,
          networks: []
        });

        if (scope.model) {
          scope.networks.push( {label: scope.model, value: scope.model} );
        }

        var currentRequestId = 0;

        function updateNetworkOptions() {
          currentRequestId++;
          var requestId = currentRequestId;
          networkReader.listNetworksByProvider('openstack').then(function(networks) {
            if (requestId !== currentRequestId) {
              return;
            }

            scope.networks = _(networks)
              .filter(scope.filter || {})
              .map(function(a) { return {label: a.name, value: a.id}; })
              .sortBy(function(o) { return o.label; })
              .valueOf();
          });
        }

        scope.$watch('filter', updateNetworkOptions);
      }
    };
});
