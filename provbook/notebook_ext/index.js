// call "provbook" and compare versions in new tab

// Author: Sheeba Samuel, <sheeba.samuel@uni-jena.de> https://github.com/Sheeba-Samuel
// Modified by: Alan Synn (alansynn@gatech.edu)

define([
    'require',
    'jquery',
    'moment',
    'base/js/namespace',
    'base/js/events',
    'notebook/js/codecell',
    'notebook/js/textcell',
    'base/js/utils'
], function (
    requirejs,
    $,
    moment,
    Jupyter,
    events,
    codecell,
    textcell,
    utils
) {
    "use strict";

    var mod_name = 'provbook';
    var log_prefix = '[' + mod_name + ']';
    var CodeCell = codecell.CodeCell;
    var MarkdownCell = textcell.MarkdownCell;
    var RawCell = textcell.RawCell
    var options = {};


    var rgx_has_timezone = new RegExp('Z|[\\-+\u2212]\\d\\d(?::?\\d\\d)?$');
    function add_utc_offset (timestamp) {
        if (timestamp !== undefined && !rgx_has_timezone.test(timestamp)) {
            return timestamp + 'Z';
        }
        return timestamp;
    }

    function patch_CodeCell_get_callbacks () {
        var old_get_callbacks = CodeCell.prototype.get_callbacks;
        CodeCell.prototype.get_callbacks = function () {
            var callbacks = old_get_callbacks.apply(this, arguments);

            var cell = this;
            var prev_reply_callback = callbacks.shell.reply;
            callbacks.shell.reply = function (msg) {
                if (msg.msg_type === 'execute_reply') {
                    $.extend(true, cell.metadata, {
                        ExecutionTime: {
                            start_time: add_utc_offset(msg.metadata.started),
                            end_time: add_utc_offset(msg.header.date),
                        }
                    });
                    update_provenance_metadata_codecell(cell);
                }
                else {
                    console.log('msg_type', msg.msg_type);
                }
                return prev_reply_callback(msg);
            };
            return callbacks;
        };
    }

    function human_readable_duration (duration_ms, item_count) {
        if (duration_ms < 1000) {
            return Math.round(duration_ms) + 'ms';
        }

        var human_readable_duration = '';

        var days = Math.floor(duration_ms / 86400000);
        if (days) {
            human_readable_duration += days + 'd ';
        }
        duration_ms %= 86400000;

        var hours = Math.floor(duration_ms / 3600000);
        if (days || hours) {
            human_readable_duration += hours + 'h ';
        }
        duration_ms %= 3600000;

        var mins = Math.floor(duration_ms / 60000);
        if (days || hours || mins) {
            human_readable_duration += mins + 'm';
        }
        duration_ms %= 60000;

        var secs = duration_ms / 1000;
        if (!days) {
            var decimals = (hours || mins > 1) ? 0 : (secs > 10 ? 1 : 2);
            human_readable_duration += (human_readable_duration ? ' ' : '') + secs.toFixed(decimals) + 's';
        }

        return human_readable_duration;
    }

    //Add provenance data to the metadata of the code cell.
    function update_provenance_metadata_codecell (cell) {
      if (!cell.metadata.hasOwnProperty("provenance")) {
            cell.metadata.provenance = [];
      }
      var execution_time, start_time, end_time = 'Unknown';
      if (cell.metadata.hasOwnProperty("ExecutionTime")) {
        var start_time = moment(cell.metadata['ExecutionTime']['start_time']),
              end_time = cell.metadata['ExecutionTime']['end_time'];
        if (end_time) {
            end_time = moment(end_time);
            var exec_time = -start_time.diff(end_time);
            execution_time = human_readable_duration(exec_time);
        }
      }
      cell.metadata.provenance.push({
        outputs: cell.output_area.outputs,
        source: cell.get_text(),
        start_time: start_time,
        end_time: end_time,
        execution_time: execution_time,
      });
    }

    //Clear provenance data from the metadata of the cell.
    function clear_provenance_data (cells) {
        cells.forEach(function (cell, idx, arr) {
            delete cell.metadata.provenance;
            delete cell.metadata.ExecutionTime;
            cell.element.find('.slider_area').remove();
        });
        events.trigger('set_dirty.Notebook', {value: true});
    }

    //Clear all the provenance data from the metadata of the notebook.
    function clear_provenance_data_all () {
        console.log(log_prefix, 'Clearing all provenance data');
        clear_provenance_data(Jupyter.notebook.get_cells());
    }

    // A Provenance Menu to display and clear the data for selected or all cells.
    function create_provenance_menu () {
      var provenance_menu_item = $('<li/>')
          .addClass('dropdown-submenu')
          .append(
              $('<a href="#">')
                  .text('Provenance')
                  .on('click', function (evt) { evt.preventDefault(); })
          )
          .appendTo($('#cell_menu'));

      var provenance_submenu = $('<ul/>')
          .addClass('dropdown-menu')
          .appendTo(provenance_menu_item);

      $('<li/>')
          .attr('title', 'Toggle the provenance box for the selected cell(s)')
          .append(
              $('<a href="#">')
                  .text('Toggle visibility (selected)')
                  .on('click', function (evt) {
                      evt.preventDefault();
                      get_provenance_of_selected_cell();
                  })
          )
          .appendTo(provenance_submenu);

      $('<li/>')
          .attr('title', 'Toggle the provenance box for all cells')
          .append(
              $('<a href="#">')
                  .text('Toggle visibility (all)')
                  .on('click', function (evt) {
                      evt.preventDefault();
                      get_provenance_of_all_cells();
                  })
          )
          .appendTo(provenance_submenu);

      $('<li/>')
          .attr('title', 'Clear the selected cell(s) provenance data')
          .append(
              $('<a href="#">')
                  .text('Clear (selected)')
                  .on('click', function (evt) {
                      evt.preventDefault();
                      clear_provenance_data(Jupyter.notebook.get_selected_cells());
                  })
          )
          .appendTo(provenance_submenu);

      $('<li/>')
          .attr('title', 'Clear the provenance data from all cells')
          .append(
              $('<a href="#">')
                  .text('Clear (all)')
                  .on('click', function (evt) {
                      evt.preventDefault();
                      clear_provenance_data_all(Jupyter.notebook.get_cells());
                  })
          )
          .appendTo(provenance_submenu);
    }

    function add_css(url) {
        $('<link/>')
            .attr({
                rel: 'stylesheet',
                href: requirejs.toUrl(url),
                type: 'text/css'
            })
            .appendTo('head');
    }

    //Display the output based on the output type
    function get_output(output) {
      var output_entry = '<p class="thick">Output:</p>';
      for(var index in output) {
        var output_type = output[index]['output_type'];
        var output_val, output_datatype;
        if (output_type == 'execute_result' || output_type == 'display_data') {
          for(var key in output[index]['data']) {
            output_datatype = key;
            output_val = output[index]['data'][key];
            if(output_datatype=='image/png') {
              output_val = '<img src="data:image/png;base64,' + output_val + '">';
            }
            output_entry = output_entry + '<div class="para_text_wrap">' + output_val + '</div>';
          }
        } else if (output_type == 'stream') {
          output_val = output[index]['text'];
          output_entry = output_entry + '<div class="para_text_wrap">' + output_val + '</div>';
        } else if (output_type == 'error') {
          output_val = output[index]['ename'];
          output_entry = output_entry + output_val;
        }
      }
      return output_entry;
    }

    //Create provenance history for each cell.
    function get_provenance_entry(provenance, execution_index) {
      var execution_time = provenance[execution_index]['execution_time'];
      var end_time = provenance[execution_index]['end_time'];
      if (end_time) {
        end_time = moment(end_time).format();
      }
      var source = provenance[execution_index]['source'];
      var output_entry = '';
      if ('outputs' in provenance[execution_index] && !Array.isArray(provenance[execution_index]['outputs'])) {
        var output_val = provenance[execution_index]['outputs'];
        if (output_val) {
          output_entry = '<p class="para_text_wrap">Output:\n' + output_val + '</p>';
          output_entry = get_output(provenance[execution_index]['outputs']);
        }
      }
      else if ('outputs' in provenance[execution_index] && provenance[execution_index]['outputs'].length > 0) {
          output_entry = get_output(provenance[execution_index]['outputs']);
      }

      var prov_hist = '<p>End Time: ' + end_time +'</p>' +
                      '<p>Execution Time: ' + execution_time +'</p>' +
                      '<p class="para_text_wrap">Source:\n' + source +'</p>' +
                      output_entry;
      return prov_hist;
    }

    // Update the provenance data which includes the save time and the source for each text cell.
    function update_provenance_metadata_textcell(cell) {
      if (!cell.metadata['provenance']) {
        cell.metadata['provenance'] = [];
      }
      cell.metadata.provenance.push({
        source: cell.get_text(),
        last_modified: Jupyter.notebook.last_modified
      });
    }

    function update_original_notebook_provenance() {
        Jupyter.notebook.get_cells().forEach(function(cell) {
          if (!(cell instanceof CodeCell || cell instanceof MarkdownCell || cell instanceof RawCell)) {
                return $();
          }
          if (!cell.metadata['provenance']) {
            cell.metadata['provenance'] = [];

            if (cell instanceof MarkdownCell || cell instanceof RawCell) {
              cell.metadata.provenance.push({
                source: cell.get_text(),
                last_modified: Jupyter.notebook.last_modified
              });
            } else if (cell instanceof CodeCell ) {
              var execution_time = 'Unknown', start_time = 'Unknown', end_time = 'Unknown';
              cell.metadata.provenance.push({
                outputs: cell.output_area.outputs,
                source: cell.get_text(),
                start_time: start_time,
                end_time: end_time,
                execution_time: execution_time,
              });
            }
          }
        });
    }

    // Create slider and provenance area to display the provenance of the text cell.
    function update_provenance_area_textcell (cell) {
      var number_of_executions = cell.metadata['provenance'].length;
      var cell_id = cell.cell_id;
      var min_val = 0;
      var max_val = number_of_executions-1;
      var slider_area = create_slider_area_textcell(cell);
      var provenance_area = create_provenance_area(cell);
      $( ".slider-range." + cell_id ).slider({
        min: min_val,
        max: max_val,
        value: min_val,
        orientation: "horizontal",
        create: function(evt, ui) {
          var last_modified = cell.metadata['provenance'][min_val]['last_modified'];
          if (last_modified) {
            last_modified = moment(last_modified).format();
          }
          $('.slider-time.' + cell_id).html(last_modified);
          $('.provenance_area.' + cell_id).html(function(){
            var source = cell.metadata['provenance'][min_val]['source'];
            var prov_hist = '<div>Source: ' + source +'</div>'
            return prov_hist;
          });

        },
        slide: function(evt, ui) {
          var last_modified = cell.metadata['provenance'][ui.value]['last_modified'];
          if (last_modified) {
            last_modified = moment(last_modified).format();
          }
          $('.slider-time.' + cell_id).html(last_modified);
          $('.provenance_area.' + cell_id).html(function(){
            var source = cell.metadata['provenance'][ui.value]['source'];
            var prov_hist = '<div>Source: ' + source +'</div>'
            return prov_hist;
          });
        },
      });

    }

    // Create slider and provenance area to display the provenance of the text cell.
    function create_slider_area_textcell(cell) {
      var cell_id = cell.cell_id;
      var slider_area = cell.element.find('.slider_area');
      if (slider_area.length < 1) {
          slider_area = $('<div id="time-range"><p>Modified Time: <span class="slider-time"></span> </p><div class="slider-range"></div></div>')
              .addClass('slider_area').addClass(cell_id)
              .insertAfter(cell.element.find('.text_cell_render'));
      }
      var slider_range = cell.element.find('.slider-range');
      slider_range.addClass(cell_id);
      var slider_time = cell.element.find('.slider-time');
      slider_time.addClass(cell_id);
      return slider_area;
    }

    // Create slider and provenance area to display the provenance of the code cell.
    function create_slider_area_codecell(cell) {
      var cell_id = cell.cell_id;
      var slider_area = cell.element.find('.slider_area');
      if (slider_area.length < 1) {
          slider_area = $('<div id="time-range"><p>Start Time: <span class="slider-time"></span> </p><div class="slider-range"></div></div>')
              .addClass('slider_area').addClass(cell_id)
              .insertAfter(cell.element.find('.input_area'));
      }
      var slider_range = cell.element.find('.slider-range');
      slider_range.addClass(cell_id);
      var slider_time = cell.element.find('.slider-time');
      slider_time.addClass(cell_id);
      return slider_area;
    }

    // Create provenance area for each cell
    function create_provenance_area(cell) {
      var cell_id = cell.cell_id;
      var provenance_area = cell.element.find('.provenance_area');
      if (provenance_area.length < 1) {
          provenance_area = $('<div/>')
              .addClass('provenance_area').addClass(cell_id)
              .appendTo(cell.element.find('.slider_area'));
      }
      return provenance_area;
    }

    // Update provenance for code cells.
    function update_provenance_area_codecell (cell) {
      var number_of_executions = cell.metadata['provenance'].length;
      var min_val = 0;
      var max_val = number_of_executions-1;
      var cell_id = cell.cell_id;

      var slider_area = create_slider_area_codecell(cell);
      var provenance_area = create_provenance_area(cell);

      $( ".slider-range." + cell_id ).slider({
        min: min_val,
        max: max_val,
        value: min_val,
        orientation: "horizontal",
        create: function(evt, ui) {
          var start_time = cell.metadata['provenance'][min_val]['start_time']
          if (start_time) {
            start_time = moment(start_time).format();
          }
          $('.slider-time.' + cell_id).html(start_time);
          $('.provenance_area.' + cell_id).html(function(){
            var no_of_executions = cell.metadata['provenance'];
            var prov_hist = get_provenance_entry(cell.metadata['provenance'], min_val);
            prov_hist = '<p>Number of Runs:' + no_of_executions.length + '</p>' + prov_hist;
            return prov_hist;
          });

        },
        slide: function(evt, ui) {
          $('.slider-time.' + cell_id).html(function(){
            var start_time = cell.metadata['provenance'][ui.value]['start_time'];
            if (start_time) {
              start_time = moment(start_time).format();
            }
            return start_time;
          });
          $('.provenance_area.' + cell_id).html(function(){
            var no_of_executions = cell.metadata['provenance']
            var prov_hist = get_provenance_entry(cell.metadata['provenance'], ui.value);
            prov_hist = '<p>Number of Runs:' + no_of_executions.length + '</p>' + prov_hist;
            return prov_hist;
          });
        },
      });
    }

    // Check the type of cell and call respective functions for each type of cell.
    function update_provenance_area (cell) {
      if ( !('provenance' in cell.metadata && cell.metadata['provenance'].length > 0)) {
        return;
      }
      if ( cell instanceof MarkdownCell || cell instanceof RawCell ) {
        update_provenance_area_textcell(cell);
      }
      else if (cell instanceof CodeCell ) {
        update_provenance_area_codecell(cell);
      }
    }

    // Toggle the display
    function toggle_provenance_display (cell, classname) {
      if (cell instanceof CodeCell || cell instanceof MarkdownCell || cell instanceof RawCell) {
        var ce = cell.element;
        var slider_area = ce.find('.slider_area');
        slider_area.toggle($("." + classname).hasClass('active'));
      }
    }

    // Get the provenance of selected cell.
    function get_provenance_of_selected_cell () {
      var cell = Jupyter.notebook.get_selected_cell();
      if (!(cell instanceof CodeCell || cell instanceof MarkdownCell || cell instanceof RawCell)) {
            return $();
      }
      var classname = 'fa-history';
      $("." + classname).toggleClass("active");
      update_provenance_area(cell);
      toggle_provenance_display(cell, classname);
    }

   // Get the provenance of all cells.
   function get_provenance_of_all_cells() {
     var classname = 'fa-asterisk';
     $("." + classname).toggleClass("active");
     Jupyter.notebook.get_cells().forEach(function(cell) {
       if (!(cell instanceof CodeCell || cell instanceof MarkdownCell || cell instanceof RawCell)) {
             return $();
       }
       update_provenance_area(cell);
       toggle_provenance_display(cell, classname);
     });
   }

   // Add two toolbar buttons
    function add_toolbar_buttons () {
  		return $(Jupyter.toolbar.add_buttons_group([
  			Jupyter.keyboard_manager.actions.register ({
  				help   : 'Provenance of selected cell',
  				icon   : 'fa-history',
  				handler: function (evt) {
  					get_provenance_of_selected_cell();
  				}
        }, 'provenance-selected-cell', 'provenance_selected_cell_btn'),
        Jupyter.keyboard_manager.actions.register ({
  				help   : 'Provenance of all cells',
  				icon   : 'fa-asterisk',
  				handler: function (evt) {
  					get_provenance_of_all_cells();
  				}
        }, 'provenance-all-cell', 'provenance_all_cell'),
        Jupyter.actions.register({
            icon: 'fa-adjust',
            help   : 'Provenance Difference of selected cell',
            handler : ProvBookDiffView
        }, 'provenance_diff_selected_cell_btn', 'provbookdiff'),
  		]));
	  }


    // Calls the notebook_rdf extension to download the provenance data in RDF.
    var callNbconvert = function () {
      events.off('notebook_saved.Notebook');
      var open_tab = true;
  		var kernel = Jupyter.notebook.kernel;
  		var notebook_name = Jupyter.notebook.notebook_name;
      var extension = '.ttl'
      var command = 'import os; os.system(\'notebook_rdf ' + notebook_name + '\')';

  		function callback_opendocument() {
  			if (open_tab === true) {
  				var url = utils.splitext(notebook_name)[0] + extension;
  				window.open(url, '_blank');
  			}
  		}
  		kernel.execute(command, { shell: { reply : callback_opendocument } });
    };

    function update_provenance_metadata(cell) {
      Jupyter.notebook.get_cells().forEach(function(cell) {
        if (cell instanceof MarkdownCell || cell instanceof RawCell) {
          update_provenance_metadata_textcell(cell);
        }
      });
    }

    // Create an entry in the Download as Menu to download the notebook in RDF.
    function create_download_rdf_menu() {
      var download_menu = $("#download_menu")
      var downloadSubMenu = $('<li id="download_html_embed"><a href="#">RDF (.ttl)</a></li>');
      download_menu.append(downloadSubMenu);
      downloadSubMenu.click(function () {
          callNbconvert();
      });
    }

    // Custom util functions:
    var reStripLeading = /^\/+/
    var stripLeft = function (string) {
        return string.replace(reStripLeading, '');
    };

    var path_join = function () {
        return stripLeft(utils.url_path_join.apply(this, arguments));
    }


    // Create provenance area for each cell
    function create_provenance_book_diff_area(cell) {
        var cell_id = cell.cell_id;
        var select_base, select_remote;
        var provenance_book_diff_area = cell.element.find('.provenance_book_diff_area');
        var base_selected_execution = 0, remote_selected_execution = 1;
        if (provenance_book_diff_area.length < 1) {
            provenance_book_diff_area = $('<div id="prov_diff_area"><p><strong>Provenance Difference</strong>: Select the options to see the difference between two executions.</p></div>')
                .addClass('provenance_book_diff_area').addClass(cell_id)
                .insertAfter(cell.element.find('.input_area'));
            select_base = $("<select></select>").attr("name", "provenance_diff_base")
                                                .attr("class", "provenance_diff_base " + cell_id)
                                                .attr("id", "provenance_diff_base " + cell_id);
            select_base.on('change', function(e){
                base_selected_execution = this.selectedIndex;
                remote_selected_execution = select_remote[0].selectedIndex;
                getprovdiff(base_selected_execution, remote_selected_execution);
            });
            select_base.appendTo(provenance_book_diff_area);

            select_remote = $("<select></select>").attr("name", "provenance_diff_remote")
                                                .attr("class", "provenance_diff_remote " + cell_id)
                                                .attr("id", "provenance_diff_remote " + cell_id);
            select_remote.on('change', function(e){
                base_selected_execution = select_base[0].selectedIndex;
                remote_selected_execution = this.selectedIndex;
                getprovdiff(base_selected_execution, remote_selected_execution);
            });
            select_remote.appendTo(provenance_book_diff_area);
            var cell_provenance = cell.metadata['provenance'];
            $('.provenance_book_diff_area.' + cell_id).html(function(){
                add_option(select_base, cell_provenance);
                add_option(select_remote, cell_provenance);
            });

        }


        return provenance_book_diff_area;
      }

    function add_option(select_element, cell_provenance) {
        for (var i = 0; i < cell_provenance.length; i++) {
            if (i==0) {
                var option = $("<option></option>")
                        .attr("class", i)
                        .text("Original Execution");
            } else if ("start_time" in cell_provenance[i] ) {
                var option = $("<option></option>")
                        .attr("class", i)
                        .text(cell_provenance[i]["start_time"]);
            }
            if(select_element) {
                select_element.append(option);
            }
        }
    }

      // Toggle the display
    function toggle_provenance_diff_display (cell, classname) {

        var cell_id = cell.cell_id;
        var provdiff_area = $('.provenance_book_diff_area.' + cell_id);
        provdiff_area.toggle($("." + classname).hasClass('active'));

    }


    var ProvBookDiffView = function () {
        var cell = Jupyter.notebook.get_selected_cell();
        var cell_id = cell.cell_id;
        create_provenance_book_diff_area(cell);
        var classname = 'fa-adjust';
        $("." + classname).toggleClass("active");
        toggle_provenance_diff_display(cell, classname);

    };

    var getprovdiff = function (base_selected_execution, remote_selected_execution) {
        var cell = Jupyter.notebook.get_selected_cell();
        var nb_dir = utils.url_path_split(Jupyter.notebook.notebook_path)[0];
        var name = Jupyter.notebook.notebook_name;
        var base = path_join(nb_dir, name);
        var url = window.location.origin + '/' + path_join(Jupyter.notebook.base_url, 'provbookdiff');
        var cell_index = Jupyter.notebook.find_cell_index(cell);
                url = url + '?base=' + base + '&cell_index=' + cell_index + '&base_selected_execution=' + base_selected_execution +
          '&remote_selected_execution=' + remote_selected_execution;

        window.open(url);
    };

    var register_provbook = function() {
        if ($.ui === undefined ) {
            requirejs(['jquery-ui'], function ($) {}, function (err) {
                // try to load using the older, non-standard name (without hyphen)
                requirejs(['jqueryui'], function ($) {}, function (err) {
                    console.log(log_prefix, 'couldn\'t find jquery-ui, so no animations');
                });
            });
        }

        var v = Jupyter.version.split(".");
        if(Number(v[0])*10+ Number(v[1]) < 51)
        {
          console.log('Notebook version 5.1.0 or higher required for this extension')
          return
        }

        add_css('./provbook.css');

        Jupyter.notebook.config.loaded.then(function on_config_loaded () {
            $.extend(true, options, Jupyter.notebook.config.data[mod_name]);
        }, function on_config_load_error (reason) {
            console.warn(log_prefix, 'Using defaults after error loading config:', reason);
        }).then(function do_stuff_with_config () {
            update_original_notebook_provenance();
            patch_CodeCell_get_callbacks();
            add_toolbar_buttons(); // Buttons for the provenance of selected and all cells
            create_provenance_menu();
            create_download_rdf_menu();
            events.on('checkpoint_created.Notebook', update_provenance_metadata);

        }).catch(function on_error (reason) {
            console.error(log_prefix, 'Error:', reason);
        });
    };


    var load_ipython_extension = function() {
        register_provbook();
    };

    return {
        load_ipython_extension : load_ipython_extension
    };
});
