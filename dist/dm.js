/* Copyright (c) 2008-2009 M@ McCray.

  REQUIRES Prototype 1.6+

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
var DM = {

  AUTHOR: "M@ McCray <darthapo@gmail.com>",
  VERSION: "0.1.2",

}

var Options = {

  setOptions: function(opts) {
    var defaultOpts = $H(this.options || {}),
        overrideOpts = $(opts || {});
    this.options = defaultOpts.merge(overrideOpts).toObject();
  }

}


DM.AirConnection = Class.create({
  initialize: function(connInfo) {
    this.type = 'air';
    this.connInfo = connInfo;
    this.connection = new air.SQLConnection();
    this._dbFile = air.File.applicationStorageDirectory.resolvePath( connInfo.name );
    this.connection.openAsync(this._dbFile); // Would I rather .open() it instead?
  },

  execute: function(sql, params, callback, options) {
    var statement = new air.SQLStatement(),
        count = 0;
    statement.sqlConnection = this.connection;

    statement.text = sql.replace(/(\?)/g, function(riddler){
      return ":"+ count++;
    });

    $H(params).each(function(pair){
      statement.parameters[":" + pair.key] = pair.value;
    });

    statement.addEventListener(air.SQLEvent.RESULT, function(){
/*
        SQLResultSet {
          readonly attribute int insertId;
          readonly attribute int rowsAffected;
          readonly attribute SQLResultSetRowList rows;
        }
        SQLResultSetRowList {
          readonly attribute unsigned long length;
          [IndexGetter] DOMObject item(in unsigned long index);
        };
*/
      callback(statement.getResult(), event);
    });

    statement.addEventListener(air.SQLErrorEvent.ERROR, function(){
    });

    statement.execute();
  }
});

(function(rt){
  if(!rt) return;
  if(window.air && air.Introspector)
    window.console = air.Introspector.Console;
  else {
    window.console = {
      log: function(msg) {
        rt.trace(msg);
      },
      info: function(msg) {
        console.log('INFO: '+ msg);
      }
    }
  }
})(window.runtime);
DM.GearsConnection = Class.create({
  initialize: function(connInfo) {
    this.type = 'gears';
    this.connInfo = connInfo;
    if(!DM.GearsConnection.gearFactory) (function(){
       if (typeof GearsFactory != 'undefined') {
         DM.GearsConnection.gearFactory = new GearsFactory();
       } else {
         try {
           DM.GearsConnection.gearFactory = new ActiveXObject('Gears.Factory');
           if (DM.GearsConnection.gearFactory.getBuildInfo().indexOf('ie_mobile') != -1) {
             DM.GearsConnection.gearFactory.privateSetGlobalObject(this);
           }
         } catch (e) {
           if ((typeof navigator.mimeTypes != 'undefined')
                && navigator.mimeTypes["application/x-googlegears"]) {
             DM.GearsConnection.gearFactory = document.createElement("object");
             DM.GearsConnection.gearFactory.style.display = "none";
             DM.GearsConnection.gearFactory.width = 0;
             DM.GearsConnection.gearFactory.height = 0;
             DM.GearsConnection.gearFactory.type = "application/x-googlegears";
             document.documentElement.appendChild(DM.GearsConnection.gearFactory);
           }
         }
       }
       if(!DM.GearsConnection.gearFactory) {
        throw "There was an error creating the GearsFactory!"; }
    })();
    this.connection = DM.GearsConnection.gearFactory.create('beta.database');
    this.connection.open(connInfo.name);
  },

  execute: function(sql, params, callback, options) {
    var results = this.connection.execute(sql, $A(params).flatten()),
        lastId = this.connection.lastInsertRowId,
        rows = [];
        (rows.constructor.prototype || rows.prototype).item = function(i) { return this[i]; }
    if (results) {
      var names = [];
      for(var i = 0; i < results.fieldCount(); i++) {
        names.push(results.fieldName(i));
      }
      while(results.isValidRow()) {
        var row = {};
        for(var i = 0; i < names.length; i++) {
          row[names[i]] = results.field(i);
        }
        rows.push(row);
        results.next();
      }
      results.close();
    }

    callback({insertId:lastId, rowsAffected:0, rows:rows});
  }
});
DM.Html5Connection = Class.create({

  initialize: function(connInfo) {
    this.connInfo = connInfo;
    this.type = 'html5';
    this.connection = openDatabase(connInfo.name, connInfo.description, connInfo.displayName || connInfo.name, connInfo.size);
  },

  execute: function(sql, params, callback, options) {
    this.connection.transaction(function(txn){
      txn.executeSql(sql, $A(params).flatten(), function(t, results){
        callback(results);
      },
      function(err){
      });
    });
  }

});

DM.ConnectionFactory = {

  connectionPool: $H(), // Well, kind of...

  getConnection: function(connInfo) {
    if( this.connectionPool.get(connInfo.name) ) {
      return this.connectionPool.get(connInfo.name);
    }

    var conn = false;

    if(typeof openDatabase != 'undefined') {
      conn = new DM.Html5Connection(connInfo);

    } else if(typeof GearsFactory != 'undefined') {
      conn = new DM.GearsConnection(connInfo);
    } else if(window.runtime && typeof window.runtime.flash.data.SQLConnection != 'undefined') {
      conn = new DM.AirConnection(connInfo);
    }

    if(conn) {
      this.connectionPool.set(connInfo.name, conn);
      return conn;
    } else {
      this.connectionPool.set(connInfo.name, null);
      throw "Unable to find a supported database!"
    }
  }

};
DM.Database = Class.create(Options, { /// EVENTS???

  options: {
    name:         '',
    description:  '',
    displayName:  false,
    size:         10240,
    preferGears:  false
  },

  initialize: function(options) {
    this.setOptions(options);
    this.conn = DM.ConnectionFactory.getConnection( this.options );
    DM.Model.DB = this;
  },

  execute: function(sql, params, callback, options) {
    if(!sql){ throw "You must provide SQL to execute"; }

    var callback = callback || function(){ /*console.log('No callback defined')*/ },
        params   = params || [],
        options  = options || {};


    this.conn.execute(sql, params, function(results){
      callback(results);
    }, options);
  }

});

DM.Dataset = Class.create({

  initialize: function(tableName) {
    this.tableName = tableName;
    this.conditions = [];
    this.values = [];
    this.ordering = [];
  },

  filter: function(col, comparator, value, cnd) {
    if( arguments.length == 2 ) {
      value = comparator;
      var colSegs = col.split(' ');
      if(colSegs.length < 2){ throw "Invalid filter syntax"; }
      comparator = colSegs.pop();
      col = colSegs.join(' '); // Would there ever be spaces?
    } else if( arguments.length == 1) {
      var args = $A(arguments[0]);
      col = args[0];
      comparator = args[1];
      value = args[2];
    }
    cnd = cnd || 'AND';
    this.conditions.push({
      col: col,
      com: comparator,
      val: '?',
      cnd: cnd
    });
    this.values.push(value);
    return this;
  },

  where: function(col, comparator, value) { return this.filter(col, comparator, value); },
  and:   function(col, comparator, value) { return this.filter(col, comparator, value, 'AND'); },
  or:    function(col, comparator, value) { return this.filter(col, comparator, value, 'OR'); },

  order: function(column, direction) {
    direction = direction || 'ASC';
    this.ordering.push(column +" "+ direction)
    return this;
  },

  each: function(callback) {
    var self = this;
    DM.Model.DB.execute(this.toSql(), this.values, function(results){
      for (var i=0; i < results.rows.length; i++) {
        var row = results.rows.item(i);
        callback( row, i, results );
      };
    });
    return this;
  },

  all: function(callback) {
    if(callback) {
      var self = this;
      DM.Model.DB.execute(this.toSql(), this.values, function(results){
        var rows = [];
        for (var i=0; i < results.rows.length; i++) {
          rows.push( results.rows.item(i)  );
        };
        callback( rows ); // As an array...
      });
    } else {
      this.conditions = [];
      this.values = [];
      this.ordering = [];
    }
    return this;
  },


  count: function(callback) {
    return this;
  },

  add: function(data, callback) {
    return this;
  },

  update: function(data, callback) {
    return this;
  },

  destroy: function(data, callback) {
    return this;
  },

  clone: function() {
    var ds = new DM.Dataset(this.tableName);
    ds.conditions = $A(this.conditions).clone();
    ds.values = $A(this.values).clone();
    ds.ordering = $A(this.ordering).clone();
    return ds;
  },

  toSql: function(cmd) {
    var cmd = cmd || 'SELECT',
        sql = cmd +" * FROM "+ this.tableName;

    if(this.conditions.length > 0) {
      sql += " WHERE ";
      $A(this.conditions).each(function(clause, count){
        if(count > 0) {
          sql += clause.cnd +" ";
        }
        sql += "("+ clause.col +" "+ clause.com +" "+ clause.val +") ";
      });
    }

    if(this.ordering.length > 0) {
      sql += " ORDER BY "+ this.ordering.join(', ');
    }

    sql += ";";

    return sql;
  },

  toString: function() {
    return this.toSql();
  }
});

Object.extend(String.prototype, {
  eq:function(value) {
    return [this, '=', value];
  },
  like:function(value) {
    return [this, 'like', value];
  },
  neq:function(value) {
    return [this, '!=', value];
  },
  lt:function(value) {
    return [this, '<', value];
  },
  gt:function(value) {
    return [this, '>', value];
  },
  lteq:function(value) {
    return [this, '<=', value];
  },
  gteq:function(value) {
    return [this, '>=', value];
  },
});
DM.ModelInstance = Class.create({
  initialize: function(attributes, klass) {
    this.table_name = klass.table_name;
    this.fields = klass.fields; // Array
    this.columns = klass.columns; // Hash
    this.klass = klass;
    this.isDirty = false;
    this.attributes = $H(attributes || {}); // Attributes from the SQLResultSet seem to be read-only
    this.id = this.attributes.get('id') || null;
  },

  get: function(attribute, raw) {
    if(attribute in this.columns) {
      if(this.columns[attribute].type == 'timestamp') {
        return (raw) ?  this.attributes.get(attribute) : new Date( this.attributes.get(attribute) );
      } else {
        return this.attributes.get(attribute);
      }
    } else {
      throw("'"+ attribute +"' is not a valid column for table "+ this.table_name);
    }
  },

  set: function(attribute, value) {
    if(attribute in this.columns) {
      if(this.columns[attribute].type == 'timestamp') {
        switch(typeof(value)) {
          case 'string':
            value = Date.parse(value); // Mabye new Date(value).getTime(); ?
            break;
          case 'number':
            value = value;
            break;
          default:
            value = value.getTime();
        }
      }
      if(value != this.attributes.get(attribute)) {
        this.isDirty = true;
        this.attributes.set(attribute, value);
      }
    } else {
      throw("'"+ attribute +"' is not a valid column for table "+ this.table_name);
    }
    return this;
  },

  update: function(attrs, ignoreErrors) {
    var self = this;
    $H(attrs).each(function(pair){
      if(pair.value != self.get(pair.key)) {
        try {
          self.set(pair.key, pair.value)
          self.isDirty = true;
        } catch(ex) {
          if(!ignoreErrors){ throw ex; }
        }
      }
    });
  },

  save: function(callback) {
    var self = this,
        callback = callback || function(){};
    if('updated_on' in this.columns){ this.set('updated_on', new Date() ); }
    if('updated_at' in this.columns){ this.set('updated_at', new Date() ); }
    if(typeof(self.id) == 'number') {
      self.klass._handleEvent('beforeSave', this);
      var cmds = DM.SQL.updateForModel(this)
      DM.Model.DB.execute( cmds[0], cmds[1], function(res) {
        self.klass._handleEvent('afterSave', self);
        callback(self);
      } );
    } else {
      if('created_on' in this.columns){ this.set('created_on', new Date() ); }
      if('created_at' in this.columns){ this.set('created_at', new Date() ); }
      self.klass._handleEvent('beforeCreate', self);
      self.klass._handleEvent('beforeSave', self);
      var cmds = DM.SQL.insertForModel(this),
          sql = cmds.first(),
          values = cmds.last();
      DM.Model.DB.execute( sql, values, function(res) {
        self.id = res.insertId;
        self.attributes.set('id', self.id);
        self.klass._handleEvent('afterSave', self);
        self.klass._handleEvent('afterCreate', self);
        callback(self);
      } );
    }
  },

  reload: function(callback) {
    if(typeof(this.id) == 'number') {
    }
  },

  destroy: function(callback) {
    if(typeof(this.id) == 'number') {
      var self = this,
          cmds = DM.SQL.deleteForModel(this),
          callback = callback || function(){};
      DM.Model.DB.execute( cmds[0], cmds[1], function(res) {
        self.id = null;
        self.set('id', null);
        callback(self);
      });
    }
  },

  toString: function() {
    return "[#Model:"+ this.table_name +" id=\""+ this.id +"\"]";
  }
});

DM.Model = (function(){ // Closure to allow truly private methods...

  return Class.create({

    initialize: function(table_name, model_def) {
      if(!model_def){ throw "Model definitions missing!"; }

      this.table_name = table_name;

      if(model_def.schema) {
        var dsl = new DM.Schema.DSL(this).id(); // Auto generate PK?

        model_def.schema(dsl); // Exec Schema DSL

        this.fields = dsl.fields; // Array
        this.columns = dsl.columns; // Hash
        this.eventHandlers = dsl.eventHandlers;

        delete model_def['schema'];

      } else {
        this.fields = [];
        this.columns = [];
        this.eventHandlers = {};
      }

      DM.Model.knownModels.set(table_name, this);
    },

    find: function(idOrWhere, callback) {
      var self = this;
      DM.Model.DB.execute("select * from "+ this.table_name +" where id = "+ idOrWhere +";", [], function(results){
        if(results.rows.length > 0) {
          var model = new DM.ModelInstance(results.rows.item(0), self);
          callback(model);
        } else {
          throw ("find( "+ idOrWhere +" ) returned 0 results.");
        }
      });
    },

    all: function(callback) { // where,
      var self = this;
      DM.Model.DB.execute("select * from "+ this.table_name +";", [], function(results){

        var models = [];
        for (var i=0; i < results.rows.length; i++) {
          var row = results.rows.item(i);
          models.push( new DM.ModelInstance(row, self)  );
        };

        callback( models );
      })
    },

    count: function(callback) {
      var self    = this,
          count   = 0;

      DM.Model.DB.execute("select count(id) as cnt from "+ this.table_name +";", [], function(results){
        count = results.rows.item(0)['cnt'];
        callback(count);
      });
    },

    destroyAll: function(callback) {
      var self = this,
          callback = callback || function(){};
      self.all(function(models){
        var modelCount = models.length,
            currentCount = 1;
        models.each(function(mdl){
          mdl.destroy(function(){
            currentCount++;
            if(currentCount == modelCount) {
              callback(models);
            }
          })
        });
      })
    },

    create: function(attributes) {
      return new DM.ModelInstance((attributes || {}), this);
    },

    _handleEvent: function(evt, model) {
      if(evt in this.eventHandlers) {
        this.eventHandlers[evt].each(function(handler){
          handler(model);
        });
      }
    }

  })
})(); // Closure


DM.Model.knownModels = $H();

DM.Model.createModels = function(){
  if(DM.Model.DB) {
    DM.Model.knownModels.each(function(modelDef){ // klass, tableName
      var klass     = modelDef.value,
          tableName = modelDef.key;
      DM.Model.DB.execute( DM.SQL.createForModel( klass ), [], function() {
        klass.tableCreated = true;
      });
    });
  } else {
    console.log("DM.Model.createModels: Error: No database is defined.");
  }
};


/*
var Script = new DM.Model('scripts', {

  schema: function(t){
    t.text('title');
    t.text('source');
    t.text('html');
    t.timestamps('on'); // Creates created_on && updated_on

    t.hasMany('Revision', { cascadeDelete:true });
  }
});
*/
DM.Schema = {
}

DM.Schema.Text = Class.create({
  initialize: function(name, opts) {
    opts = opts || {};
    this.name = name;
    this.type = 'text';
    this.defaultValue = opts.defaultValue;
    this.allowNull = opts.allowNull;
    if(opts.notNull)
      this.allowNull = !opts.notNull;
  }
});

DM.Schema.Integer = Class.create({
  initialize: function(name, opts) {
    opts = opts || {};
    this.name = name;
    this.type = 'integer'
    this.defaultValue = (opts.primaryKey) ? undefined : opts.defaultValue;
    this.allowNull = opts.allowNull;
    if(opts.notNull)
      this.allowNull = !opts.notNull;
    if(opts.primaryKey)
      this.type = ' INTEGER PRIMARY KEY AUTOINCREMENT'
  }
});

DM.Schema.Float = Class.create({
  initialize: function(name, opts) {
    opts = opts || {};
    this.name = name;
    this.type = 'real';
    this.defaultValue = opts.defaultValue;
    this.allowNull = opts.allowNull;
    if(opts.notNull)
      this.allowNull = !opts.notNull;
  }
});

DM.Schema.Blob = Class.create({
  initialize: function(name, opts) {
    opts = opts || {};
    this.name = name;
    this.type = 'blob';
    this.defaultValue = opts.defaultValue;
    this.allowNull = opts.allowNull;
    if(opts.notNull)
      this.allowNull = !opts.notNull;
  }
});

DM.Schema.Timestamp = Class.create({
  initialize: function(name, opts) {
    opts = opts || {};
    this.name = name;
    this.type = 'timestamp';
    this.defaultValue = opts.defaultValue;
    this.allowNull = opts.allowNull;
    if(opts.notNull)
      this.allowNull = !opts.notNull;
  }
});

DM.Schema.DSL = Class.create({
  initialize: function(model) {
    this.model = model;
    this.fields = [];
    this.dateFields = [];
    this.columns = {}; // by column name...
    this.eventHandlers = {
      'beforeSave': $A([]),
      'afterSave': $A([]),
      'beforeCreate': $A([]),
      'afterCreate': $A([])
    }
  },

  id: function(name, opts) {
    var pk = name || 'id',
        fld = new DM.Schema.Integer(pk, { primaryKey:true });
    this.fields.push( fld );
    this.columns[pk] = fld;
    return this;
  },

  text: function(name, opts) {
    var fld = new DM.Schema.Text(name, opts);
    this.fields.push( fld )
    this.columns[name] = fld;
    return this;
  },

  blob: function(name, opts) {
    var fld = new DM.Schema.Blob(name, opts);
    this.fields.push( fld )
    this.columns[name] = fld;
    return this;
  },

  timestamp: function(name, opts) {
    var field = new DM.Schema.Timestamp(name, opts)
    this.fields.push( field );
    this.dateFields.push( field );
    this.columns[name] = field;
    return this;
  },

  integer: function(name,opts) {
    var fld = new DM.Schema.Integer(name, opts);
    this.fields.push( fld );
    this.columns[name] = fld;
    return this;
  },

  'float': function(name,opts) {
    var fld = new DM.Schema.Float(name, opts);
    this.fields.push( fld );
    this.columns[name] = fld;
    return this;
  },

  timestamps: function(onOrAt) {
    onOrAt = onOrAt || 'on';
    this.timestamp('created_'+ onOrAt, { defaultValue:'NOW' });
    this.timestamp('updated_'+ onOrAt, { defaultValue:'NOW' });
    return this;
  },

  foreignKey: function(name, opts) {
  },

  hasMany: function(model, opts) {
  },

  hasOne: function(model, opts) {

  },

  belongsTo: function(model, opts) {

  },

  hasAndBelongsToMany: function(model, opts) {

  },

  beforeSave: function(handler) {
    this.eventHandlers['beforeSave'].push(handler);
  },

  afterSave: function(handler) {
    this.eventHandlers['afterSave'].push(handler);
  },

  beforeCreate: function(handler) {
    this.eventHandlers['beforeCreate'].push(handler);
  },

  afterCreate: function(handler) {
    this.eventHandlers['afterCreate'].push(handler);
  }
})

DM.SQL = (function(){

  function query() {
    return $A(arguments).join(' ');
  }

  function safeFields(model) {
    return model.fields.filter(function(f){ return (f.name != 'id')})
  }

  return {

    createForModel: function(model) {
      var sql = query(
        'CREATE TABLE',
        'IF NOT EXISTS',
        model.table_name,
        '(',
          model.fields.map( function(fld){ return query(fld.name, fld.type) }).join(', '),
        ');'
      );
      return sql;
    },

    updateForModel: function(model) {
      var values = [],
          sql = query(
            'UPDATE',
            model.table_name,
            'SET',
            safeFields(model).map(function(fld){
                values.push(model.get(fld.name, true));
                return query(fld.name, '=', '?')
            }).join(', '),
            'WHERE id = ?;'
          );
      values.push( model.id );
      return [sql, values];
    },

    insertForModel: function(model) {
      var values = [],
          sql = query(
            'INSERT INTO',
            model.table_name,
            '(',
            safeFields(model).map(function(fld){
                values.push( model.get(fld.name, true) );
                return fld.name;
            }).join(', '),
            ') VALUES (',
            safeFields(model).map(function(fld){
                return '?';
            }).join(', '),
            ");"
          );
      return [sql, values];
    },

    deleteForModel: function(model) {
      var sql = query(
        "DELETE FROM",
        model.table_name,
        "WHERE id = ?;"
      );
      return [sql, [model.id]]
    }
  }
})();

