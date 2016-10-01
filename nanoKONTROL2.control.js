loadAPI(1);

host.defineController("Korg", "nanoKONTROL 2 (simple)", "1.0", "094bfc0c-0f0b-439a-8162-5f087089c58b");
host.defineMidiPorts(1, 1);
var ECHO_ID = "11";
host.defineSysexDiscovery("F0 42 50 00" + ECHO_ID + "F7", "F0 42 50 01 ?? " + ECHO_ID + " 13 01 00 00 ?? ?? ?? ?? F7");
host.addDeviceNameBasedDiscoveryPair(["nanoKONTROL2"], ["nanoKONTROL2"]);

var SYSEX_HEADER = "F0 42 40 00 01 13 00";

var CC =
{
	CYCLE : 0x2E,
	REW : 0x2B,
	FF : 0x2C,
	STOP : 0x2A,
	PLAY : 0x29,
	REC : 0x2D,
	PREV_TRACK : 0x3A,
	NEXT_TRACK : 0x3B,
	SET : 0x3C,
	PREV_MARKER : 0x3D,
	NEXT_MARKER : 0x3E,
	SLIDER1 : 0x00,
	SLIDER8 : 0x07,
	KNOB1 : 0x10,
	KNOB8 : 0x17,
	S1 : 32,
	S8 : 0x27,
	M1 : 48,
	M8 : 0x37,
	R1 : 64,
	R8 : 0x47
};

var pendingLedState = initArray(0, 128);
var outputLedState = initArray(0, 128);

var isSetPressed = false;
var isPlay = false;
var isRecording = false;
var isLooping = false;
var isEngineOn = false;
var isStopPressed = false;
var isPlayPressed = false;
var isRecPressed = false;

function init()
{
	host.getMidiInPort(0).setMidiCallback(onMidi);

	// ///////////////////////////////////////////////////////// sections
	transport = host.createTransportSection();
	application = host.createApplicationSection();
	trackBank = host.createTrackBankSection(8, 1, 0);
	cursorTrack = host.createCursorTrackSection(2, 0);
	arranger = host.createArrangerSection(0);

	transport.addIsPlayingObserver(function(on)
	{
		isPlay = on;
	});

	transport.addIsRecordingObserver(function(on)
	{
      isRecording = on;
	});
	transport.addIsLoopActiveObserver(function(on)
	{
      isLooping = on;
	});

	for ( var t = 0; t < 8; t++)
	{
		var track = trackBank.getTrack(t);
		track.getVolume().setLabel("V" + (t + 1));
		track.getPan().setLabel("P" + (t + 1));

		track.getSolo().addValueObserver(getTrackObserverFunc(t, function(index, state)
		{
			mixerPage.solo[index] = state;
		}));
		track.getMute().addValueObserver(getTrackObserverFunc(t, function(index, state)
		{
         mixerPage.mute[index] = state;
		}));
		track.getArm().addValueObserver(getTrackObserverFunc(t, function(index, state)
		{
         mixerPage.arm[index] = state;
		}));

	}
	application.addHasActiveEngineObserver(function(on)
	{
		isEngineOn = on;
	});
	sendSysex(SYSEX_HEADER + "00 00 01 F7"); // Enter native mode
	initNanoKontrol2();

   host.scheduleTask(blinkTimer, null, 200);
}

var blink = false;

function blinkTimer()
{
   blink = !blink;

   host.scheduleTask(blinkTimer, null, 200);
}

function exit()
{
	allIndicationsOff();
	sendSysex(SYSEX_HEADER + "00 00 00 F7"); // Leave native mode
}

function flush()
{
   mixerPage.prepareOutput();

   for(var cc = CC.S1; cc <= CC.R8; cc++)
   {
      checkLedOutput(cc);
   }

   for(var cc = 0x2A; cc <= 0x2E; cc++)
   {
      checkLedOutput(cc);
   }

   for(var cc = 0x3A; cc <= 0x3E; cc++)
   {
      checkLedOutput(cc);
   }
}

function checkLedOutput(cc)
{
   if (pendingLedState[cc] != outputLedState[cc])
   {
      sendChannelController(15, cc, pendingLedState[cc]);
      outputLedState[cc] = pendingLedState[cc];
   }
}

function setOutput(cc, val)
{
   pendingLedState[cc] = val;
}

function onMidi(status, data1, data2)
{
	var cc = data1;
	var val = data2;
	// printMidi(status, cc, val);

	if (status == 0xBF)
	{
		switch (cc)
		{
			case CC.SET:
				isSetPressed = val > 0;
				break;
			case CC.STOP:
				isStopPressed = val > 0;
				break;
			case CC.PLAY:
				isPlayPressed = val > 0;
				break;
			case CC.REC:
				isRecPressed = val > 0;
				break;
		}
		if (isStopPressed && isPlayPressed && isRecPressed)
		{
			toggleEngineState();
		}

		var index = data1 & 0xf;

		if (withinRange(cc, CC.SLIDER1, CC.SLIDER8))
		{
			mixerPage.onSlider(index, val);
		}
		else if (withinRange(cc, CC.KNOB1, CC.KNOB8))
		{
			mixerPage.onKnob(index, val);
		}

		if (val > 0) // ignore when buttons are released
		{

			if (withinRange(cc, CC.M1, CC.M8))
			{
				mixerPage.mButton(index);
			}
			else if (withinRange(cc, CC.S1, CC.S8))
			{
				mixerPage.sButton(index);
			}
			else if (withinRange(cc, CC.R1, CC.R8))
			{
				mixerPage.rButton(index);
			}

			switch (cc)
			{
				case CC.PLAY:
					if (isEngineOn)
					{
						if (!isStopPressed && !isRecPressed) isSetPressed ? transport.returnToArrangement() : isPlay ? transport.restart() : transport.play();
					}
					else transport.restart();
					break;

				case CC.STOP:
					if (!isPlayPressed && !isRecPressed) isSetPressed ? transport.resetAutomationOverrides() : transport.stop();
					break;

				case CC.REC:
					if (!isPlayPressed && !isStopPressed) isSetPressed ? cursorTrack.getArm().toggle() : transport.record();
					break;

				case CC.CYCLE:
					transport.toggleLoop();
					break;

				case CC.REW:
					transport.rewind();
					break;

				case CC.FF:
					isSetPressed ? arranger.togglePlaybackFollow() : transport.fastForward();
					break;

				case CC.PREV_TRACK:
					mixerPage.prevTrackButton();
					break;

				case CC.NEXT_TRACK:
					mixerPage.nextTrackButton();
					break;

				case CC.PREV_MARKER:
					mixerPage.prevMarkerButton();
					break;

				case CC.NEXT_MARKER:
					mixerPage.nextMarkerButton();
					break;

        case CC.SET:
          mixerPage.setMarkerButton();
          break;
			}
		}
	}
}

function onSysex(data)
{
}
function getTrackObserverFunc(index, f)
{
	return function(value)
	{
		f(index, value);
	};
}
function allIndicationsOff()
{
	for ( var p = 0; p < 8; p++)
	{
		trackBank.getTrack(p).getVolume().setIndication(false);
		trackBank.getTrack(p).getPan().setIndication(false);
	}
}

function toggleEngineState()
{
	isEngineOn ? application.deactivateEngine() : application.activateEngine();
}

function initNanoKontrol2()
{
	mixerPage.updateIndications();
}

function Page()
{
}

Page.prototype.prepareCommonOutput = function()
{
   setOutput(CC.PLAY, isPlay ? 127 : 0);
   setOutput(CC.STOP, !isPlay ? 127 : 0);
   setOutput(CC.REC, isRecording ? 127 : 0);
   setOutput(CC.CYCLE, isLooping ? 127 : 0);
};

/* mixer page */////////////////////////////////////////////////////////////////
mixerPage = new Page();

mixerPage.solo = initArray(false, 8);
mixerPage.mute = initArray(false, 8);
mixerPage.arm = initArray(false, 8);

mixerPage.prepareOutput = function()
{
   this.prepareCommonOutput();

   for (var i = 0; i < 8; i++)
   {
      setOutput(CC.S1 + i, this.solo[i] ? 127 : 0);
      setOutput(CC.M1 + i, this.mute[i] ? 127 : 0);
      setOutput(CC.R1 + i, this.arm[i] ? 127 : 0);
   }
};

mixerPage.onKnob = function(index, val)
{
	isSetPressed ? trackBank.getTrack(index).getPan().reset() : trackBank.getTrack(index).getPan().set(val, 128);
};

mixerPage.onSlider = function(index, val)
{
	isSetPressed ? trackBank.getTrack(index).getVolume().reset() : trackBank.getTrack(index).getVolume().set(val, 128);
};

mixerPage.sButton = function(index)
{
	trackBank.getTrack(index).getSolo().toggle();
};

mixerPage.mButton = function(index)
{
	trackBank.getTrack(index).getMute().toggle();
};

mixerPage.rButton = function(index)
{
	trackBank.getTrack(index).getArm().toggle();
};

mixerPage.prevTrackButton = function()
{
	isSetPressed ? trackBank.scrollTracksPageUp() : cursorTrack.selectPrevious();
};

mixerPage.nextTrackButton = function()
{
	isSetPressed ? trackBank.scrollTracksPageDown() : cursorTrack.selectNext();
};

mixerPage.prevMarkerButton = function()
{
//	transport.previousMarker(); // activate when it exists in the API
};

mixerPage.nextMarkerButton = function()
{
//	transport.nextMarker(); // activate when it exists in the API
};

mixerPage.setMarkerButton = function() {

};

mixerPage.updateIndications = function()
{
	for ( var p = 0; p < 8; p++)
	{
		track = trackBank.getTrack(p);
		track.getVolume().setIndication(true);
		track.getPan().setIndication(true);
	}
};
