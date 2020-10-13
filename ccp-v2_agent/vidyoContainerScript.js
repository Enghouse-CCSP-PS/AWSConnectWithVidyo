/*************** Begin Mod Area ***************/
/* Edit the instanceName below with your instance alias */
/* InstanceName at data.json */

window.vueInstance = new Vue({
  data: {
    instanceName: "",
    vidyoApiUrlPrefix: "",
    // token: null,
    roomKey: null,
    entityID: null,
    extension: null,
    roomKey: null,
    agent: null,
    roomLink: null,
    vidyoConnector: null,
    vidyoPlatformTenant: "",
    participantsDDL: {},
    participantsObject: {},
    vidyoCallStatus: "",
    currentVidyoParticipantCtrl: null,
    currentVidyoParticipantName: null,
    currentVidyoParticipantId: null,
    vidyoStopped: false,
    tokenAgentPassword: "",
    startBtnDisabled: false,
    vidyoCallStatusTypes: {
      Connected: "Connected",
      Disconnected: "Disconnected",
      Try: "Try",
      Ready: "Ready",
    },
    nowShare: null,
    nowMic: null,
    nowVideo: null,
    localShare: null,
    timeoutForDisconnectVidyoID: null,
    timeoutForDisconnectVidyoMS: null,
  },
  mounted() {
    //Get data.json parameters
    fetch("data.json")
      .then((res) => res.json())
      .then((data) => {
        this.vidyoApiUrlPrefix = data.vidyoApiUrlPrefix;
        this.vidyoPlatformTenant = data.vidyoPlatformTenant;
        this.instanceName = data.instanceName;
        this.tokenAgentPassword = data.tokenAgentPassword;
        this.timeoutForDisconnectVidyoMS = data.timeoutForDisconnectVidyoMS;

        //When ready - init functions
        this.initCCPInstance();
        this.overrideConsole();
        window.onVidyoClientLoaded = this.onVidyoClientLoaded.bind(this);
      });

    //prevent the option to click on startVidyo button, when try to connect onload page
    if (localStorage.getItem("vidyo_participantId")) {
      this.startBtnDisabled = true;
    }
  },
  methods: {
    //override console log,debug,error
    overrideConsole() {
      if (window.console && console.log && console.error && console.debug) {
        let oldConsoleLog = console.log;
        let oldConsoleError = console.error;
        let oldConsoleDebug = console.debug;
        console.log = function () {
          Array.prototype.unshift.call(arguments, "Vidyo: ");
          oldConsoleLog.apply(this, arguments);
        };
        console.error = function () {
          Array.prototype.unshift.call(arguments, "Vidyo: ");
          oldConsoleError.apply(this, arguments);
        };
        console.debug = function () {
          Array.prototype.unshift.call(arguments, "Vidyo: ");
          oldConsoleDebug.apply(this, arguments);
        };
      }
    },

    // init CCP
    initCCPInstance() {
      connect.core.initCCP(containerDiv, {
        ccpUrl:
          "https://" + this.instanceName + ".awsapps.com/connect/ccp-v2#/",
        loginPopup: true,
        region: "eu-west-2",
        softphone: {
          allowFramedSoftphone: true,
        },
      });

      //for logout
      let eventBus = connect.core.getEventBus();
      eventBus.subscribe(connect.EventType.TERMINATED, () => {
        console.debug("Logged out");
        document.querySelector("iframe").style.display = "none";
        this.unregisterVidyoListenersAndDestruct();
        this.removeVidyoLibraryFromDOM();
      });

      connect.contact((contact) => {
        //Contact Listeners
        contact.onAccepted((contact) => {
          console.debug(contact, "contact.onAccepted...");

          //when accepted we want to show the "start video" button, unless we are in middle of video session.
          if (!this.startBtnDisabled) {
            this.vidyoCallStatus = this.vidyoCallStatusTypes.Disconnected;
          }
        });

        contact.onEnded((contact) => {
          /*onEnded invoked 2 times: 
                        1) At end chat.
                        2) At close chat history.
                        The first case doesn't contain "contactData", so we want only catch this case.*/
          if (!contact.contactData) {
            /*if the customer who ended the call is the customer in middle of video.
                            or if agent finish the chat - so check if the current ended chat is belong to customer with video */
            if (contact.contactId === this.currentVidyoParticipantId) {
              this.disconnectVidyoSession();
            } else if (!this.isAnyCustomerConnected()) {
              this.vidyoCallStatus = "";
            }
          }
        });
        contact.onDestroy((contact) => {
          console.debug("onDestroy");
        });
        contact.onMissed((contact) => {
          if (!this.isAnyCustomerConnected()) {
            this.vidyoCallStatus = "";
          }
          console.debug("onMissed");
        });
      });

      connect.agent((agent) => {
        this.agent = new connect.Agent();

        //if particiants with chat, show "start vidyo", else hide the vidyo buttons
        if (this.isAnyCustomerConnected()) {
          this.vidyoCallStatus = this.vidyoCallStatusTypes.Disconnected;
        } else {
          this.vidyoCallStatus = "";
        }

        //Agent Listeners

        agent.onRefresh((agent) => {
          console.debug("agent onRefresh", agent);
          console.debug(agent.getContacts());

          agent.getContacts().forEach((it) => {
            //if vidyo call interrupted (like page refreshed..), so try to connect again
            if (
              (this.vidyoCallStatus == this.vidyoCallStatusTypes.Disconnected ||
                this.vidyoCallStatus == "") &&
              it.contactId.toString() ===
                localStorage.getItem("vidyo_participantId").toString()
            ) {
              //parse paramters from localstorage to connect again
              let params = this.getCustomUrlVars(
                localStorage.getItem("vidyo_roomlink")
              );
              console.debug(params);
              this.vidyoPlatformTenant = params.host;
              // this.token = params.token;
              this.roomKey = params.roomkey;
              this.entityID = localStorage.getItem("vidyo_entityID").toString();
              this.extension = localStorage
                .getItem("vidyo_extension")
                .toString();
              //set for all participant at participant object
              this.agent.getContacts().forEach((c) => {
                this.participantsObject[c.contactId] = c;
              });

              //need to set controller in order to send message (like disconnect..)
              //false parameter its mean do not create token (because it exist already)
              this.prepareControllerAndToken(it.contactId, false);
              this.currentVidyoParticipantId = it.contactId;
              this.setTimeoutForConnectingVidyo();
            }
          });
        });
      });
    },

    isAnyCustomerConnected() {
      let found = false;
      this.agent.getContacts().forEach((it) => {
        if (it.getStatus().type == "connected") {
          found = true;
        }
      });
      return found;
    },

    /*setTimout with time which configured at data.js, for disconnect if not succeded
           connected to vidyo within this time*/
    setTimeoutForConnectingVidyo() {
      clearTimeout(this.timeoutForDisconnectVidyoID);
      //if after "timeoutForDisconnectVidyoMS" still not connected, so disconnect.
      this.timeoutForDisconnectVidyoID = setTimeout(() => {
        if (this.vidyoCallStatus !== this.vidyoCallStatusTypes.Connected) {
          this.disconnectVidyoSessionTriggered();
          clearTimeout(this.timeoutForDisconnectVidyoID);
        }
      }, this.timeoutForDisconnectVidyoMS);
    },

    //send message (with link or with orders (like end chat..))
    sendChatMessageToVidyoParticipant(message) {
      console.debug(
        "send message... in ctrl:",
        this.currentVidyoParticipantCtrl
      );
      return this.currentVidyoParticipantCtrl
        .sendMessage({
          message: message,
          contentType: "text/plain",
        })
        .then((res, req) => {
          return res;
        })
        .catch((e) => {
          console.debug(e);
        });
    },

    //parse the url from localhost after refresh
    getCustomUrlVars(url) {
      let vars = {};
      let parts = url.replace(/[?&]+([^=&]+)=([^&]*)/gi, function (
        m,
        key,
        value
      ) {
        let k = key.toLowerCase();
        vars[k] = value;
      });
      return vars;
    },

    //on click "start vidyo session"
    async startVidyoSessionClicked() {
      this.setTimeoutForConnectingVidyo();

      //empty object of participants and DDL
      this.participantsDDL = {};
      this.participantsObject = {};
      this.vidyoStopped = false;

      //prepare object of participants and DDL
      this.agent.getContacts().forEach((c) => {
        this.participantsDDL[
          c.contactId
        ] = c.getAttributes().customerName.value;
        this.participantsObject[c.contactId] = c;
      });

      //in case there is more than one participant - DDL opened to choose one
      if (Object.keys(this.participantsDDL).length > 1) {
        try {
          const { value: participant } = await Swal.fire({
            title: "Please Choose participant for vidyo call",
            input: "select",
            inputOptions: this.participantsDDL,
            inputPlaceholder: "Please choose participant",
            showCancelButton: true,
            inputValidator: (value) => {
              return new Promise((resolve) => {
                if (value) {
                  resolve();
                } else {
                  resolve("Please choose participant");
                }
              });
            },
          });

          //if pariticpant choosed
          if (participant) {
            this.startBtnDisabled = true;
            // Swal.fire(`You choosed: ${participant}`)
            //"true" - create token
            this.prepareControllerAndToken(participant, true);
          } else {
            this.startBtnDisabled = false;
          }
        } catch (e) {
          console.debug(e);
        }
      }
      //in case there is only one participant
      else if (Object.keys(this.participantsDDL).length == 1) {
        this.startBtnDisabled = true;
        this.prepareControllerAndToken(
          Object.keys(this.participantsDDL)[0],
          true
        );
      }
    },

    /*perform disconnection*/
    disconnectVidyoSession() {
      console.debug("Vidyo: on disconnectVidyoSession");
      this.deleteRoom();
      this.vidyoStopped = true;
      if (!this.vidyoConnector || !this.vidyoConnector.Disconnect) {
        this.endVidyoSession();
        return;
      }
      return this.vidyoConnector
        .Disconnect()
        .then((e) => {
          this.endVidyoSession();
          console.debug("Vidyo: Disconnect Success", e);
          return;
        })
        .catch((e) => {
          //case of ready state but not connected
          this.endVidyoSession();
          console.error("Vidyo: Can't Disconnect,", e);
          return;
        });
    },

    //on disconnect button triggered
    disconnectVidyoSessionTriggered() {
      //in case vidyo connection doesnt established
      //use this way, since somtimes disconnect before vidyoConnector of participant initilized
      //also for end chat by agent
      this.sendChatMessageToVidyoParticipant("system:cancel_vidyo_session")
        .then(() => {
          this.disconnectVidyoSession();
        })
        .catch((e) => {
          console.error("Send Message Fail", e);
        });
    },

    //join to call after connector created
    joinVidyoCall(vidyoPlatformTenant, displayName, roomKey) {
      // Add Token and Connect To Conference
      this.vidyoConnector
        .ConnectToRoomAsGuest({
          host: vidyoPlatformTenant,
          // token: token, //needed for agent and customer
          displayName: displayName, //How my name looks only on participant screen
          roomKey: roomKey, //Conference Name, needed for agent and customer
          pin: "",
          onSuccess: () => {
            //set devices
            this.vidyoConnector.SelectDefaultCamera();
            this.vidyoConnector.SelectDefaultMicrophone();
            this.vidyoConnector.SelectDefaultSpeaker();

            console.debug("YAY!! Vidyo Sucessfully connected");
            this.vidyoCallStatus = this.vidyoCallStatusTypes.Connected;
          },
          onFailure: (reason) => {
            console.error("Error while connecting ", reason);
          },
          onDisconnected: (reason) => {
            console.debug("Disconnected ", reason);
          },
        })
        .then(function (status) {})
        .catch(function (e) {
          console.error(e);
        });
    },

    //createLink for regular case, initVidyo without create token - for after refresh case
    prepareControllerAndToken(participantId, createLink) {
      let participant = this.participantsObject[participantId];
      this.currentVidyoParticipantName = participant.getAttributes().customerName.value;
      participant
        .getAgentConnection()
        .getMediaController()
        .then((controller) => {
          //not continue if connecting vidyo aborted
          //needed here because it's async response
          if (this.vidyoStopped) {
            return;
          }
          this.currentVidyoParticipantCtrl = controller;
          //in case of regular new call
          if (createLink) {
            //the parameter is the *connection* id of particiapnt
            this.createLinkWithRoomKey(
              this.participantsObject[participantId].getInitialConnection()
                .connectionId
            ).then(() => {
              if (
                this.vidyoConnector &&
                this.vidyoConnector.GetState
                //&&
                // this.vidyoConnector.GetState()._result ==
                //   "VIDYO_CONNECTORSTATE_Ready"
              ) {
                this.joinVidyoCall(
                  this.vidyoPlatformTenant,
                  // this.token,
                  this.agent.getName(),
                  this.roomKey
                );
              }
            });

            this.initVidyo();
          }
          //in case of after refresh, so the link already created
          else {
            this.initVidyo();
          }
        })
        .catch((e) => {
          console.error(e);
        });
    },

    /*initilize the vidyo data and call relevant methods*/
    endVidyoSession() {
      this.startBtnDisabled = false;
      console.info("Vidyo: on endVidyoSession ");
      localStorage.removeItem("vidyo_roomlink");
      localStorage.removeItem("vidyo_participantId");
      localStorage.removeItem("vidyo_entityID");
      localStorage.removeItem("vidyo_extension");
      this.currentVidyoParticipantCtrl = null;
      this.currentVidyoParticipantName = null;
      this.currentVidyoParticipantId = null;
      this.roomKey = null;

      if (this.vidyoConnector && this.vidyoConnector.SelectLocalCamera) {
        this.vidyoConnector.SelectLocalCamera({ localCamera: null });
        this.vidyoConnector.SelectLocalMicrophone({ localMicrophone: null });
        this.vidyoConnector.SelectLocalSpeaker({ localSpeaker: null });
      }
      if (!this.isAnyCustomerConnected()) {
        this.vidyoCallStatus = "";
      } else {
        this.vidyoCallStatus = this.vidyoCallStatusTypes.Disconnected;
      }
    },

    /*unregister listenter of Vidyo
           only at logout*/
    unregisterVidyoListenersAndDestruct() {
      console.debug("on unregisterVidyoListenersAndDestruct");

      //"UnregisterLocalCameraEventListener" is for example, in order to check if the vidyoConnector contains the listeners functions
      if (
        this.vidyoConnector &&
        this.vidyoConnector.UnregisterLocalCameraEventListener
      ) {
        this.vidyoConnector.UnregisterLocalCameraEventListener();
        this.vidyoConnector.UnregisterLocalMicrophoneEventListener();
        this.vidyoConnector.UnregisterLocalSpeakerEventListener();
        this.vidyoConnector.UnregisterLocalWindowShareEventListener();
        this.vidyoConnector.UnregisterParticipantEventListener();
        this.vidyoConnector.UnregisterMessageEventListener();
        this.vidyoConnector.Destruct();
      }
    },

    //remove html elements of Vidyo from DOM
    removeVidyoLibraryFromDOM() {
      console.debug("Vidyo: VidyoService on remove library from DOM");
      let script = document.querySelector("script[src*='VidyoClient.js']");
      let css = document.querySelector("link[href*='VidyoClient.css']");
      if (script) {
        script.remove();
        console.debug("Vidyo: Script of Vidyo library removed from DOM");
      }
      if (css) {
        css.remove();
        console.debug("Vidyo: Css of Vidyo library removed from DOM");
      }
      document.querySelector("#renderer").innerHTML = "";
      this.vidyoConnector = null;
    },

    //register listener of Vidyo
    registerVidyoListeners() {
      this.vidyoConnector
        .RegisterLocalCameraEventListener({
          onAdded: (localCamera) => {
            console.debug("localCamera onAdded", localCamera);
          },
          onRemoved: function (localCamera) {
            console.debug("localCamera onRemoved", localCamera);
          },
          onSelected: (localCamera) => {
            console.debug("localCamera onSelected", localCamera);

            if (localCamera) {
              localCamera.SetPreviewLabel({
                previewLabel: this.agent.getName(),
              });
              this.nowVideo = true;
            }
          },
          onStateUpdated: function (localCamera, state) {
            console.debug("localCamera onStateUpdated", localCamera);
          },
        })
        .then(function () {
          console.debug("RegisterLocalCameraEventListener Success");
        })
        .catch(function () {
          console.error("RegisterLocalCameraEventListener Failed");
        });

      this.vidyoConnector
        .RegisterLocalMicrophoneEventListener({
          onAdded: function (localMicrophone) {
            console.debug(
              "RegisterLocalMicrophoneEventListener onAdded",
              localMicrophone
            );
          },
          onRemoved: function (localMicrophone) {
            console.debug(
              "RegisterLocalMicrophoneEventListener onRemoved",
              localMicrophone
            );
          },
          onSelected: (localMicrophone) => {
            console.debug(
              "RegisterLocalMicrophoneEventListener onSelected",
              localMicrophone
            );
            if (localMicrophone) {
              this.nowMic = true;
            }
          },
          onStateUpdated: function (localMicrophone, state) {
            console.debug(
              "RegisterLocalMicrophoneEventListener onStateUpdated",
              localMicrophone,
              state
            );
          },
        })
        .then(function () {
          console.debug("RegisterLocalMicrophoneEventListener Success");
        })
        .catch(function () {
          console.error("RegisterLocalMicrophoneEventListener Failed");
        });

      this.vidyoConnector
        .RegisterLocalSpeakerEventListener({
          onAdded: function (localSpeaker) {
            console.debug("localSpeaker onAdded");
          },
          onRemoved: function (localSpeaker) {},
          onSelected: function (localSpeaker) {},
          onStateUpdated: function (localSpeaker, state) {},
        })
        .then(function () {
          console.debug("RegisterLocalSpeakerEventListener Success");
        })
        .catch(function () {
          console.error("RegisterLocalSpeakerEventListener Failed");
        });

      /* Register to receive chat messages */
      this.vidyoConnector
        .RegisterMessageEventListener({
          onChatMessageReceived: (participant, chatMessage) => {
            /* Message received from other participant */
            console.debug(
              "onChatMessageReceived : participant, chatMessage ",
              participant,
              chatMessage
            );
            if (chatMessage.body === "system:cancel_vidyo_session") {
              this.disconnectVidyoSession();
            }
          },
        })
        .then(function () {
          console.debug("RegisterMessageEventListener Success");
        })
        .catch(function () {
          console.err("RegisterMessageEventListener Failed");
        });

      this.vidyoConnector
        .RegisterLocalWindowShareEventListener({
          onAdded: (localWindowShare) => {
            console.log(
              "RegisterLocalWindowShareEventListener onAdded",
              localWindowShare
            );
            this.localShare = localWindowShare;
          },
          onRemoved: (localWindowShare) => {
            console.log(
              "RegisterLocalWindowShareEventListener onRemoved",
              localWindowShare
            );
          },
          onSelected: (localWindowShare) => {
            if (!localWindowShare) {
              console.debug("Vidyo: Stop SelectLocalWindowShare Success");
              this.nowShare = false;
            }
          },
          onStateUpdated: (localWindowShare, state) => {
            console.log(
              "RegisterLocalWindowShareEventListener onStateUpdated",
              localWindowShare,
              state
            );
          },
        })
        .then(function (result) {
          if (result) {
            console.debug("RegisterLocalWindowShareEventListener Success");
          } else {
            console.error("RegisterLocalWindowShareEventListener Failed");
          }
        })
        .catch(function () {
          console.error("RegisterLocalWindowShareEventListener Failed");
        });

      this.vidyoConnector
        .RegisterParticipantEventListener({
          onJoined: function (participant) {
            /* Participant Joined */
          },
          onLeft: (participant) => {
            console.debug("Vidyo: Participant Left ", participant);
          },
          onDynamicChanged: (participants) => {
            console.debug(
              "Vidyo: Ordered array of participants according to rank ",
              participants
            );
            if (participants.length == 1 && participants[0].isLocal) {
              console.debug("Vidyo:Only me on conversation...");
            }
            /* Ordered array of participants according to rank */
          },
          onLoudestChanged: function (participant, audioOnly) {
            /* Current loudest speaker */
          },
        })
        .then(function () {
          console.debug("Vidyo: RegisterParticipantEventListener Success");
        })
        .catch(function () {
          console.err("Vidyo: RegisterParticipantEventListener Failed");
        });
    },

    //create auth token
    authenticateUser(user, password) {
      let token = user + ":" + password;
      // Base64 Encoding -> btoa
      let hash = btoa(token);

      return "Basic " + hash;
    },

    //Create link with token in order to connect Vidyo session
    createLinkWithRoomKey(connectionId) {
      //   this.resourceId = connectionId;
      let agentModifiedName = encodeURI(this.agent.getName());
      let agentAuthToken = this.authenticateUser(
        agentModifiedName,
        this.tokenAgentPassword
      );
      return new Promise((resolve, reject) => {
        //not continue if connecting vidyo aborted
        if (this.vidyoStopped) {
          reject(Error("Vidyo stopped"));
        }
        $.ajax({
          url: this.vidyoApiUrlPrefix + "Create",
          type: "GET",
          data: {
            userName: agentModifiedName,
            tenantID: this.instanceName,
          },
          dataType: "json",
          beforeSend: (xhr) => {
            //set auth token
            xhr.setRequestHeader("Authorization", agentAuthToken);
          },
          success: (data) => {
            //not continue if connecting vidyo aborted
            if (this.vidyoStopped) {
              return;
            }

            //If error
            if (!data || (data && !data.success && data.errorDescription)) {
              reject(Error(data.errorDescription));
              this.vidyoCallStatus = this.vidyoCallStatusTypes.Disconnected;
              return;
            }
            console.debug("Got Vidyo roomKey ", data);
            // this.token = data.token;
            this.roomKey = data.roomKey;
            this.entityID = data.entityID;
            this.extension = data.extension;
            this.roomLink = `https://web-static.alpha.vidyo.com/VidyoConnector/hunter/index.html?host=${this.vidyoPlatformTenant}&roomKey=${this.roomKey}&displayName=${this.currentVidyoParticipantName}&autoJoin=1`;
            console.debug("roomLink: ", this.roomLink);

            //When finished create token - send it to participant
            this.sendChatMessageToVidyoParticipant(this.roomLink).then(
              (res) => {
                console.debug(res.status);
                this.currentVidyoParticipantId = this.currentVidyoParticipantCtrl.getChatDetails().contactId;
                localStorage.setItem("vidyo_roomlink", this.roomLink);
                localStorage.setItem(
                  "vidyo_participantId",
                  this.currentVidyoParticipantId.toString()
                );
                localStorage.setItem(
                  "vidyo_entityID",
                  this.entityID.toString()
                );
                localStorage.setItem(
                  "vidyo_extension",
                  this.extension.toString()
                );
              },
              () => {
                console.debug("Send token link faild..");
              }
            );

            resolve();
          },
        }).fail(function (e) {
          reject(Error(e));
          this.vidyoCallStatus = this.vidyoCallStatusTypes.Disconnected;
        });
      });
    },

    deleteRoom(onSuccess) {
      let agentModifiedName = encodeURI(this.agent.getName());
      let agentAuthToken = this.authenticateUser(
        agentModifiedName,
        this.tokenAgentPassword
      );
      if (!navigator.sendBeacon) {
        $.ajax({
          url: this.vidyoApiUrlPrefix + "Delete",
          type: "POST",
          data: {
            userName: agentModifiedName,
            tenantID: this.instanceName,
            extension: this.extension,
            entityID: this.entityID,
          },
          dataType: "json",
          headers: {
            Authorization: agentAuthToken,
          },
          success: function (data) {
            console.debug("[vidyo] Delete room", data);
            if (data.success && onSuccess) {
              onSuccess(data);
            } else {
              console.error(data);
            }
          },
        }).fail(function (e) {
          console.error(Error(e));
        });
      } else {
        var obj = {
          userName: agentModifiedName,
          tenantID: this.instanceName,
          extension: this.extension,
          entityID: this.entityID,
          authHeader: agentAuthToken.substring(6),
        };
        var _url = this.vidyoApiUrlPrefix + "DeleteRaw";
        var ans = navigator.sendBeacon(_url, JSON.stringify(obj));
        console.log("sendBeacon: DeleteRaw ", ans);
      }
    },

    //on video button click
    toggleVideo() {
      if (this.nowVideo) {
        this.muteCamera();
      } else {
        this.unmuteCamera();
      }
    },

    //on mic button click
    toggleMic() {
      if (this.nowMic) {
        this.muteMicrophone();
      } else {
        this.unmuteMicrophone();
      }
    },
    //on share button click
    toggleShare() {
      if (this.nowShare) {
        this.stopShare();
      } else {
        this.startShare();
      }
    },

    startShare() {
      return this.vidyoConnector
        .SelectLocalWindowShare({
          localWindowShare: this.localShare,
        })
        .then((res) => {
          if (res) {
            console.debug("Vidyo: localWindowShare: " + this.localShare.name);
            console.debug("Vidyo: Start SelectLocalWindowShare Success");
            this.nowShare = true;
          }
          return;
        })
        .catch(() => {
          console.error("Vidyo: Start SelectLocalWindowShare Failed");
          return;
        });
    },

    stopShare() {
      return this.vidyoConnector
        .SelectLocalWindowShare({
          localWindowShare: null,
        })
        .then(() => {
          console.debug("Vidyo: Stop SelectLocalWindowShare Success");
          this.nowShare = false;
          return;
        })
        .catch(() => {
          console.error("Vidyo: Stop SelectLocalWindowShare Failed");
          return;
        });
    },

    // handle mute video
    muteCamera() {
      return this.vidyoConnector
        .SetCameraPrivacy({
          privacy: true,
        })
        .then((res) => {
          console.debug("Vidyo: Mute Camera Success");
          this.nowVideo = false;
          return res;
        })
        .catch(function () {
          console.error("Vidyo: Mute Camera Failed");
        });
    },

    // handle unmute video
    unmuteCamera() {
      return this.vidyoConnector
        .SetCameraPrivacy({
          privacy: false,
        })
        .then((res) => {
          console.debug("Vidyo: Unmute Camera Success", res);
          this.nowVideo = true;
          return;
        })
        .catch(() => {
          console.error("Vidyo: Unmute Camera Failed");
          return;
        });
    },

    // handle mute mic
    muteMicrophone() {
      return this.vidyoConnector
        .SetMicrophonePrivacy({
          privacy: true,
        })
        .then((res) => {
          console.debug("Vidyo: Mute Microphone Success", res);
          this.nowMic = false;
          return;
        })
        .catch((res) => {
          console.error("Vidyo: Mute Microphone Failed", res);
          return;
        });
    },

    // handle unmute mic
    unmuteMicrophone() {
      return this.vidyoConnector
        .SetMicrophonePrivacy({
          privacy: false,
        })
        .then((res) => {
          console.debug("Vidyo: Unmute Microphone Success", res);
          this.nowMic = true;
          return;
        })
        .catch((res) => {
          console.error("Vidyo: Unmute Microphone Failed", res);
          return;
        });
    },

    //switch video cameras
    switchCamera() {
      this.vidyoConnector.CycleCamera();
    },

    //init vidyo session
    initVidyo() {
      console.debug("on initVidyo");
      this.vidyoCallStatus = this.vidyoCallStatusTypes.Try;

      //not continue if connecting vidyo aborted
      if (this.vidyoStopped) {
        return Error("Vidyo stopped");
      }

      //if already connector
      if (
        this.vidyoConnector &&
        this.vidyoConnector.GetState
        //&& this.vidyoConnector.GetState ()._result == "VIDYO_CONNECTORSTATE_Ready"
      ) {
        console.debug("Already exist vidyoConnector");
        this.vidyoCallStatus = this.vidyoCallStatusTypes.Ready;
        return;
      }
      this.loadScript();
    },

    loadScript() {
      let script = document.createElement("script");
      script.type = "text/javascript";
      script.id = "VidyoClientScript";
      script.src =
        "https://web-static.alpha.vidyo.com/VidyoConnector/latest_build/VidyoClient.js";
      script.onload = function () {
        onVidyoClientLoaded({
          state: "READY",
          description: "Native SCIP + WebRTC",
        });
      };
      document.body.appendChild(script);

      let style = document.createElement("link");
      style.rel = "stylesheet";
      style.type = "text/css";
      style.href =
        "https://web-static.alpha.vidyo.com/VidyoConnector/latest_build/VidyoClient.css";
      document.getElementsByTagName("head")[0].appendChild(style);
    },

    // method invoked from vidyo script
    onVidyoClientLoaded(status) {
      //not continue if connecting vidyo aborted
      if (this.vidyoStopped) {
        return Error("Vidyo stopped");
      }
      console.debug("VidyoClient load state - " + status.state);
      if (status.state == "READY") {
        window.VC = new window.VidyoClientLib.VidyoClient("", () => {
          VC.CreateVidyoConnector({
            viewId: "renderer", // Div ID where the composited video will be rendered, see VidyoConnector.html;
            viewStyle: "VIDYO_CONNECTORVIEWSTYLE_Default", // Visual style of the composited renderer
            remoteParticipants: 8, // Maximum number of participants to render
            logFileFilter: "warning all@VidyoClient all@VidyoConnector",
            logFileName: "",
            userData: "",
          })
            .then((vc) => {
              this.vidyoCallStatus = this.vidyoCallStatusTypes.Ready;
              //not continue if connecting vidyo aborted
              //needed here because it's async response
              if (this.vidyoStopped) {
                reject(Error("Vidyo stopped"));
              }
              console.debug("CreateVidyoConnector success");
              this.vidyoConnector = vc;
              if (this.roomKey) {
                this.joinVidyoCall(
                  this.vidyoPlatformTenant,
                  // this.token,
                  this.agent.getName(),
                  this.roomKey
                );
              }
              this.registerVidyoListeners();
            })
            .catch((error) => {
              console.error("CreateVidyoConnector Failed " + error);
            });
        });
      }
    },
  },
}).$mount("#app");

/*************** End Mod Area ***************/
