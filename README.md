fileTransfer-angular-module
===========================

Include `fileTransfer` module in your project. Inject factory `fileTransfer` to use it.

Start a new transfer
```shell
var transfer = fileTransfer.newTransfer();
```

Provide message with a way to send messages
```shell
transfer.setSender(function(message) {
  //send message somehow
})
```

Call this function when you receive a fileTransfer message
```shell
transfer.onmessage(message)
```

Now you can send your file
```shell
transfer.sendFile(file)
```
