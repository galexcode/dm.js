// database.js
DM.Database = Class.create(Options, { /// EVENTS???
  
  options: {
    name:         '',
    description:  '',
    displayName:  false,
    size:         10240,
    preferGears:  false
    // onResults: $empty ????
  },
  
  initialize: function(options) {
    this.setOptions(options);
    // This will be the appropriate DB Connection
    this.conn = DM.ConnectionFactory.getConnection( this.options ); 
    DM.Model.DB = this;
  },
  
  execute: function(sql, params, callback, options) {
    if(!sql){ throw "You must provide SQL to execute"; }
    
    var callback = callback || function(){ /*console.log('No callback defined')*/ },
        params   = params || [],
        options  = options || {};
    
    // console.log("Executing: "+ sql);
    // console.log("With params: "+ Object.inspect(params))
    
    this.conn.execute(sql, params, function(results){
      // TODO: Should Database.execute do anything with the results before calling the callback?
      callback(results);
    }, options);
  }
  
});

// For testing: 
// (new DM.Database()).execute( "SELECT * FROM TEST WHERE id = ? and name = ?", 10, 'Matt' )