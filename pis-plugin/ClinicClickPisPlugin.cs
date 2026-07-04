using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Data.OleDb;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace ClinicClick.PisPlugin
{
    internal sealed class PendingResponse
    {
        public List<ImportJob> Jobs;
    }

    internal sealed class ImportJob
    {
        public string Id;

        public string Status;

        public PatientData Patient;

        public List<PrescriptionData> Prescriptions;
    }

    internal sealed class PatientData
    {
        public string FirstName;

        public string LastName;

        public int Age;

        public string Gender;

        public string Address;

        public string FirstVisit;
    }

    internal sealed class PrescriptionData
    {
        public string Text;

        public string Date;
    }

    internal sealed class TimeoutWebClient : WebClient
    {
        protected override WebRequest GetWebRequest(Uri address)
        {
            WebRequest request = base.GetWebRequest(address);
            // Windows proxy auto-detection (WPAD) can stall requests for
            // over a minute on legacy installs; the demo talks directly.
            request.Proxy = null;
            request.Timeout = 10000;
            HttpWebRequest httpRequest = request as HttpWebRequest;
            if (httpRequest != null) httpRequest.ReadWriteTimeout = 10000;
            return request;
        }
    }

    internal sealed class SimpleJson
    {
        private readonly string text;
        private int index;

        private SimpleJson(string text)
        {
            this.text = text ?? "";
        }

        public static object Parse(string text)
        {
            SimpleJson parser = new SimpleJson(text);
            object value = parser.ReadValue();
            parser.SkipWhiteSpace();
            if (parser.index != parser.text.Length) throw new FormatException("Unexpected JSON content.");
            return value;
        }

        private object ReadValue()
        {
            SkipWhiteSpace();
            if (index >= text.Length) throw new FormatException("Unexpected end of JSON.");
            char current = text[index];
            if (current == '{') return ReadObject();
            if (current == '[') return ReadArray();
            if (current == '"') return ReadString();
            if (current == '-' || Char.IsDigit(current)) return ReadNumber();
            if (ReadLiteral("true")) return true;
            if (ReadLiteral("false")) return false;
            if (ReadLiteral("null")) return null;
            throw new FormatException("Invalid JSON value.");
        }

        private Dictionary<string, object> ReadObject()
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            index++;
            SkipWhiteSpace();
            if (Consume('}')) return result;
            while (true)
            {
                SkipWhiteSpace();
                string key = ReadString();
                SkipWhiteSpace();
                Expect(':');
                result[key] = ReadValue();
                SkipWhiteSpace();
                if (Consume('}')) return result;
                Expect(',');
            }
        }

        private List<object> ReadArray()
        {
            List<object> result = new List<object>();
            index++;
            SkipWhiteSpace();
            if (Consume(']')) return result;
            while (true)
            {
                result.Add(ReadValue());
                SkipWhiteSpace();
                if (Consume(']')) return result;
                Expect(',');
            }
        }

        private string ReadString()
        {
            Expect('"');
            StringBuilder result = new StringBuilder();
            while (index < text.Length)
            {
                char current = text[index++];
                if (current == '"') return result.ToString();
                if (current != '\\')
                {
                    result.Append(current);
                    continue;
                }
                if (index >= text.Length) throw new FormatException("Invalid JSON escape.");
                char escaped = text[index++];
                if (escaped == '"' || escaped == '\\' || escaped == '/') result.Append(escaped);
                else if (escaped == 'b') result.Append('\b');
                else if (escaped == 'f') result.Append('\f');
                else if (escaped == 'n') result.Append('\n');
                else if (escaped == 'r') result.Append('\r');
                else if (escaped == 't') result.Append('\t');
                else if (escaped == 'u') result.Append(ReadUnicodeEscape());
                else throw new FormatException("Invalid JSON escape.");
            }
            throw new FormatException("Unterminated JSON string.");
        }

        private char ReadUnicodeEscape()
        {
            if (index + 4 > text.Length) throw new FormatException("Invalid JSON unicode escape.");
            int value = 0;
            for (int i = 0; i < 4; i++)
            {
                char current = text[index++];
                value <<= 4;
                if (current >= '0' && current <= '9') value += current - '0';
                else if (current >= 'a' && current <= 'f') value += current - 'a' + 10;
                else if (current >= 'A' && current <= 'F') value += current - 'A' + 10;
                else throw new FormatException("Invalid JSON unicode escape.");
            }
            return (char)value;
        }

        private object ReadNumber()
        {
            int start = index;
            if (text[index] == '-') index++;
            while (index < text.Length && Char.IsDigit(text[index])) index++;
            bool floatingPoint = false;
            if (index < text.Length && text[index] == '.')
            {
                floatingPoint = true;
                index++;
                while (index < text.Length && Char.IsDigit(text[index])) index++;
            }
            if (index < text.Length && (text[index] == 'e' || text[index] == 'E'))
            {
                floatingPoint = true;
                index++;
                if (index < text.Length && (text[index] == '+' || text[index] == '-')) index++;
                while (index < text.Length && Char.IsDigit(text[index])) index++;
            }

            string token = text.Substring(start, index - start);
            if (floatingPoint) return Double.Parse(token, CultureInfo.InvariantCulture);
            return Int64.Parse(token, CultureInfo.InvariantCulture);
        }

        private bool ReadLiteral(string literal)
        {
            if (String.Compare(text, index, literal, 0, literal.Length, StringComparison.Ordinal) != 0) return false;
            index += literal.Length;
            return true;
        }

        private bool Consume(char expected)
        {
            if (index >= text.Length || text[index] != expected) return false;
            index++;
            return true;
        }

        private void Expect(char expected)
        {
            if (!Consume(expected)) throw new FormatException("Expected '" + expected + "' in JSON.");
        }

        private void SkipWhiteSpace()
        {
            while (index < text.Length && Char.IsWhiteSpace(text[index])) index++;
        }
    }

    public static class Plugin
    {
        private const string DefaultApiUrl = "http://65.20.78.208";
        private const string ClinicId = "clinic-demo";
        private static bool installed;

        private static ListView activityList;
        private static Label lastImportLabel;

        private static readonly object stateLock = new object();
        private static bool syncConnected;
        private static string syncDetail = "Starting...";
        private static DateTime syncLastPoll = DateTime.MinValue;
        private static int queriesAnswered;
        private static string lastAnsweredQuery = "None yet";
        private static string lastImportSummary = "Never";

        public static void Install(Form host)
        {
            if (installed || host == null) return;
            installed = true;

            TabControl tabs = FindControl<TabControl>(host);
            if (tabs == null) throw new InvalidOperationException("PIS tab control was not found.");
            foreach (TabPage existing in tabs.TabPages)
                if (existing.Name == "clinicClickImportTab") return;

            TabPage page = new TabPage("Get New Data from App");
            page.Name = "clinicClickImportTab";

            GroupBox importGroup = new GroupBox();
            importGroup.Text = "Import from ClinicClick App";
            importGroup.Left = 12;
            importGroup.Top = 12;
            importGroup.Width = page.ClientSize.Width > 200 ? page.ClientSize.Width - 24 : 750;
            importGroup.Height = 96;
            importGroup.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            Label help = new Label();
            help.Text = "Downloads approved patient records from the ClinicClick app. " +
                "You review every record before anything is saved.";
            help.AutoSize = true;
            help.Left = 14;
            help.Top = 22;

            Button importButton = new Button();
            importButton.Text = "Get New Data";
            importButton.Width = 140;
            importButton.Height = 28;
            importButton.Left = 14;
            importButton.Top = 50;

            lastImportLabel = new Label();
            lastImportLabel.Text = "Last import: never";
            lastImportLabel.AutoSize = true;
            lastImportLabel.Left = 170;
            lastImportLabel.Top = 57;
            lastImportLabel.ForeColor = System.Drawing.SystemColors.GrayText;

            importGroup.Controls.Add(help);
            importGroup.Controls.Add(importButton);
            importGroup.Controls.Add(lastImportLabel);

            GroupBox activityGroup = new GroupBox();
            activityGroup.Text = "Activity";
            activityGroup.Left = 12;
            activityGroup.Top = 116;
            activityGroup.Width = importGroup.Width;
            activityGroup.Height = page.ClientSize.Height > 260 ? page.ClientSize.Height - 128 : 240;
            activityGroup.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;

            activityList = new ListView();
            activityList.View = View.Details;
            activityList.FullRowSelect = true;
            activityList.HeaderStyle = ColumnHeaderStyle.Nonclickable;
            activityList.Left = 14;
            activityList.Top = 22;
            activityList.Width = activityGroup.Width - 28;
            activityList.Height = activityGroup.Height - 36;
            activityList.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            activityList.Columns.Add("Time", 70);
            activityList.Columns.Add("Event", activityList.Width - 90);

            activityGroup.Controls.Add(activityList);

            importButton.Click += delegate
            {
                RunImport(host, tabs, importButton);
            };

            page.Controls.Add(importGroup);
            page.Controls.Add(activityGroup);
            tabs.TabPages.Add(page);

            InstallInfoButton(host);
            Log("Ready.");
            StartLiveSync(host);
        }

        private static void InstallInfoButton(Form host)
        {
            Button infoButton = new Button();
            infoButton.Text = "i";
            infoButton.Font = new System.Drawing.Font("Georgia", 9F, System.Drawing.FontStyle.Bold | System.Drawing.FontStyle.Italic);
            infoButton.Width = 24;
            infoButton.Height = 22;
            infoButton.Left = host.ClientSize.Width - infoButton.Width - 6;
            infoButton.Top = 3;
            infoButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            infoButton.TabStop = false;

            ToolTip tip = new ToolTip();
            tip.SetToolTip(infoButton, "Connection and sync status");

            infoButton.Click += delegate
            {
                ShowStatusDialog(host);
            };

            host.Controls.Add(infoButton);
            infoButton.BringToFront();
        }

        private static void ShowStatusDialog(Form host)
        {
            using (Form dialog = new Form())
            {
                dialog.Text = "ClinicClick System Status";
                dialog.StartPosition = FormStartPosition.CenterParent;
                dialog.Width = 500;
                dialog.Height = 350;
                dialog.MinimizeBox = false;
                dialog.MaximizeBox = false;
                dialog.FormBorderStyle = FormBorderStyle.FixedDialog;

                ListView list = new ListView();
                list.View = View.Details;
                list.FullRowSelect = true;
                list.HeaderStyle = ColumnHeaderStyle.Nonclickable;
                list.Left = 12;
                list.Top = 12;
                list.Width = 464;
                list.Height = 250;
                list.Columns.Add("Item", 150);
                list.Columns.Add("Status", 300);

                Button refresh = new Button();
                refresh.Text = "Refresh";
                refresh.Width = 100;
                refresh.Height = 28;
                refresh.Left = 262;
                refresh.Top = 274;

                Button close = new Button();
                close.Text = "Close";
                close.Width = 100;
                close.Height = 28;
                close.Left = 376;
                close.Top = 274;
                close.DialogResult = DialogResult.Cancel;

                refresh.Click += delegate
                {
                    FillStatusRows(dialog, list);
                };

                dialog.Controls.Add(list);
                dialog.Controls.Add(refresh);
                dialog.Controls.Add(close);
                dialog.CancelButton = close;

                FillStatusRows(dialog, list);
                dialog.ShowDialog(host);
            }
        }

        private static void FillStatusRows(Form dialog, ListView list)
        {
            string apiUrl = ResolveApiUrl();
            bool connected;
            string detail;
            DateTime lastPoll;
            int answered;
            string lastAnswered;
            string lastImport;
            lock (stateLock)
            {
                connected = syncConnected;
                detail = syncDetail;
                lastPoll = syncLastPoll;
                answered = queriesAnswered;
                lastAnswered = lastAnsweredQuery;
                lastImport = lastImportSummary;
            }

            string databasePath = Path.Combine(Application.StartupPath, "Homeopathy.mdb");

            list.BeginUpdate();
            list.Items.Clear();
            AddStatusRow(list, "Server address", apiUrl);
            AddStatusRow(list, "Server health", "Checking...");
            AddStatusRow(list, "Live sync", connected ? "Connected" : "Not connected — " + detail);
            AddStatusRow(list, "Last server check", lastPoll == DateTime.MinValue
                ? "Not yet" : lastPoll.ToString("HH:mm:ss", CultureInfo.InvariantCulture));
            AddStatusRow(list, "Web queries answered", answered.ToString(CultureInfo.InvariantCulture));
            AddStatusRow(list, "Last query", lastAnswered);
            AddStatusRow(list, "Database", File.Exists(databasePath) ? "Found" : "MISSING: " + databasePath);
            AddStatusRow(list, "Last import", lastImport);
            list.EndUpdate();

            Thread checker = new Thread(delegate()
            {
                string health;
                try
                {
                    using (TimeoutWebClient client = new TimeoutWebClient())
                    {
                        client.Encoding = Encoding.UTF8;
                        client.DownloadString(apiUrl + "/health");
                    }
                    health = "Online";
                }
                catch (Exception ex)
                {
                    health = "Unreachable — " + ex.Message;
                }
                try
                {
                    if (!dialog.IsDisposed)
                    {
                        dialog.Invoke(new MethodInvoker(delegate
                        {
                            if (list.Items.Count > 1) list.Items[1].SubItems[1].Text = health;
                        }));
                    }
                }
                catch { }
            });
            checker.IsBackground = true;
            checker.Start();
        }

        private static void AddStatusRow(ListView list, string name, string value)
        {
            ListViewItem item = new ListViewItem(name);
            item.SubItems.Add(value);
            list.Items.Add(item);
        }

        private static string ResolveApiUrl()
        {
            string apiUrl = ConfigurationManager.AppSettings["ClinicClickApiUrl"];
            if (String.IsNullOrEmpty(apiUrl)) apiUrl = DefaultApiUrl;
            return apiUrl.TrimEnd('/');
        }

        private static void Log(string message)
        {
            ListView list = activityList;
            if (list == null || list.IsDisposed) return;
            MethodInvoker append = delegate
            {
                ListViewItem item = new ListViewItem(DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture));
                item.SubItems.Add(message);
                list.Items.Add(item);
                while (list.Items.Count > 200) list.Items.RemoveAt(0);
                item.EnsureVisible();
            };
            try
            {
                if (list.InvokeRequired) list.Invoke(append);
                else
                {
                    append();
                    Application.DoEvents();
                }
            }
            catch { }
        }

        private static void UpdateLastImportLabel(string summary)
        {
            lock (stateLock)
            {
                lastImportSummary = summary + " at " +
                    DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
            }
            Label label = lastImportLabel;
            if (label == null || label.IsDisposed) return;
            MethodInvoker update = delegate
            {
                label.Text = "Last import: " + summary;
            };
            try
            {
                if (label.InvokeRequired) label.Invoke(update);
                else update();
            }
            catch { }
        }

        private static void RunImport(Form host, TabControl tabs, Button button)
        {
            button.Enabled = false;

            try
            {
                string apiUrl = ResolveApiUrl();
                Log("Step 1/4: Contacting server " + apiUrl + " ...");

                PendingResponse pending = DownloadPending(apiUrl);
                if (pending == null || pending.Jobs == null || pending.Jobs.Count == 0)
                {
                    Log("Server answered: no new approved data is waiting.");
                    MessageBox.Show("No new approved data is waiting.", "ClinicClick",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                Log("Step 2/4: Server sent " + pending.Jobs.Count + " record(s). Validating...");
                foreach (ImportJob job in pending.Jobs) ValidateDemoJob(job);

                Log("Step 2/4: Waiting for your review...");
                if (!ShowPreviewDialog(host, pending.Jobs))
                {
                    Log("Import cancelled by user. Nothing was written.");
                    return;
                }

                string databasePath = Path.Combine(Application.StartupPath, "Homeopathy.mdb");
                if (!File.Exists(databasePath)) throw new FileNotFoundException("Homeopathy.mdb was not found.", databasePath);
                Log("Step 3/4: Backing up database (first import only)...");
                EnsureBackup(databasePath);

                int imported = 0;
                int skipped = 0;
                using (OleDbConnection connection = new OleDbConnection(ConnectionString(databasePath)))
                {
                    connection.Open();
                    EnsureImportTable(connection);
                    int position = 0;
                    foreach (ImportJob job in pending.Jobs)
                    {
                        position++;
                        string name = (job.Patient.FirstName + " " + job.Patient.LastName).Trim();
                        if (WasImported(connection, job.Id))
                        {
                            skipped++;
                            Log("Step 3/4: (" + position + "/" + pending.Jobs.Count + ") " + name + " was already imported. Skipping.");
                            TryAcknowledge(apiUrl, job.Id);
                            continue;
                        }

                        Log("Step 3/4: (" + position + "/" + pending.Jobs.Count + ") Importing " + name + "...");
                        ImportOne(connection, job);
                        imported++;
                        TryAcknowledge(apiUrl, job.Id);
                    }
                }

                Log("Step 4/4: Refreshing patient table...");
                RefreshPatientGrid(host);
                string summary = String.Format(CultureInfo.InvariantCulture,
                    "Imported {0} new record(s). Skipped {1} already imported record(s).", imported, skipped);
                Log("Done. " + summary);
                UpdateLastImportLabel(summary);
                tabs.SelectedIndex = 0;
                MessageBox.Show(summary, "ClinicClick Import Complete",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                Log("FAILED: " + ex.Message);
                MessageBox.Show("Import failed: " + ex.Message, "ClinicClick Import Error",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                button.Enabled = true;
            }
        }

        private static bool ShowPreviewDialog(Form host, List<ImportJob> jobs)
        {
            using (Form dialog = new Form())
            {
                dialog.Text = "Review New Data Before Import";
                dialog.StartPosition = FormStartPosition.CenterParent;
                dialog.Width = 700;
                dialog.Height = 420;
                dialog.MinimizeBox = false;
                dialog.MaximizeBox = false;
                dialog.FormBorderStyle = FormBorderStyle.FixedDialog;

                Label caption = new Label();
                caption.Text = jobs.Count + " approved record(s) are ready. Review them, then click Import.";
                caption.AutoSize = true;
                caption.Left = 16;
                caption.Top = 14;

                ListView list = new ListView();
                list.View = View.Details;
                list.FullRowSelect = true;
                list.GridLines = true;
                list.Left = 16;
                list.Top = 40;
                list.Width = 652;
                list.Height = 270;
                list.Columns.Add("Name", 190);
                list.Columns.Add("Age", 45);
                list.Columns.Add("Gender", 55);
                list.Columns.Add("Address", 150);
                list.Columns.Add("First visit", 80);
                list.Columns.Add("Prescriptions", 110);

                foreach (ImportJob job in jobs)
                {
                    ListViewItem item = new ListViewItem((job.Patient.FirstName + " " + job.Patient.LastName).Trim());
                    item.SubItems.Add(job.Patient.Age.ToString(CultureInfo.InvariantCulture));
                    item.SubItems.Add(job.Patient.Gender);
                    item.SubItems.Add(job.Patient.Address);
                    item.SubItems.Add(job.Patient.FirstVisit);
                    int count = job.Prescriptions == null ? 0 : job.Prescriptions.Count;
                    item.SubItems.Add(count.ToString(CultureInfo.InvariantCulture));
                    list.Items.Add(item);
                }

                Button import = new Button();
                import.Text = "Import " + jobs.Count + " record(s)";
                import.Width = 160;
                import.Height = 32;
                import.Left = 366;
                import.Top = 322;
                import.DialogResult = DialogResult.OK;

                Button cancel = new Button();
                cancel.Text = "Cancel";
                cancel.Width = 130;
                cancel.Height = 32;
                cancel.Left = 538;
                cancel.Top = 322;
                cancel.DialogResult = DialogResult.Cancel;

                dialog.Controls.Add(caption);
                dialog.Controls.Add(list);
                dialog.Controls.Add(import);
                dialog.Controls.Add(cancel);
                dialog.AcceptButton = import;
                dialog.CancelButton = cancel;

                return dialog.ShowDialog(host) == DialogResult.OK;
            }
        }

        private static void StartLiveSync(Form host)
        {
            Thread worker = new Thread(delegate()
            {
                LiveSyncLoop(host);
            });
            worker.IsBackground = true;
            worker.Name = "ClinicClickLiveSync";
            worker.Start();
        }

        private static void LiveSyncLoop(Form host)
        {
            string apiUrl = ResolveApiUrl();
            while (!host.IsDisposed)
            {
                try
                {
                    string json;
                    using (TimeoutWebClient client = new TimeoutWebClient())
                    {
                        client.Encoding = Encoding.UTF8;
                        json = client.DownloadString(apiUrl + "/api/pis/queries?clinic_id=" + ClinicId);
                    }
                    lock (stateLock)
                    {
                        syncConnected = true;
                        syncDetail = "Connected";
                        syncLastPoll = DateTime.Now;
                    }

                    Dictionary<long, string> queryIds;
                    foreach (long regNo in ReadQueryRegNos(json, out queryIds))
                    {
                        string resultJson = BuildPatientResult(regNo);
                        using (TimeoutWebClient client = new TimeoutWebClient())
                        {
                            client.Encoding = Encoding.UTF8;
                            client.Headers[HttpRequestHeader.ContentType] = "application/json";
                            client.UploadString(
                                apiUrl + "/api/pis/queries/" + Uri.EscapeDataString(queryIds[regNo]) + "/result",
                                "POST", resultJson);
                        }
                        lock (stateLock)
                        {
                            queriesAnswered++;
                            lastAnsweredQuery = "Patient " + regNo + " at " +
                                DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
                        }
                    }
                }
                catch (Exception ex)
                {
                    lock (stateLock)
                    {
                        syncConnected = false;
                        syncDetail = ex.Message;
                    }
                }
                Thread.Sleep(4000);
            }
        }

        private static List<long> ReadQueryRegNos(string json, out Dictionary<long, string> queryIds)
        {
            queryIds = new Dictionary<long, string>();
            List<long> regNos = new List<long>();
            Dictionary<string, object> root = SimpleJson.Parse(json) as Dictionary<string, object>;
            if (root == null) return regNos;
            List<object> queries = GetArray(root, "queries", false);
            if (queries == null) return regNos;
            for (int i = 0; i < queries.Count; i++)
            {
                Dictionary<string, object> item = queries[i] as Dictionary<string, object>;
                if (item == null) continue;
                string id = GetString(item, "id", true);
                long regNo = GetInt(item, "regno");
                if (!queryIds.ContainsKey(regNo))
                {
                    queryIds[regNo] = id;
                    regNos.Add(regNo);
                }
            }
            return regNos;
        }

        private static string BuildPatientResult(long regNo)
        {
            string databasePath = Path.Combine(Application.StartupPath, "Homeopathy.mdb");
            if (!File.Exists(databasePath)) return "{\"found\":false,\"error\":\"Database not found\"}";

            using (OleDbConnection connection = new OleDbConnection(ConnectionString(databasePath)))
            {
                connection.Open();

                StringBuilder result = new StringBuilder();
                using (OleDbCommand command = new OleDbCommand(
                    "SELECT [RegNo],[FirstName],[LastName],[Age],[Gender],[Address],[FirstVisit] " +
                    "FROM [Patient] WHERE [RegNo]=?", connection))
                {
                    command.Parameters.Add("@RegNo", OleDbType.Integer).Value = (int)regNo;
                    using (OleDbDataReader reader = command.ExecuteReader())
                    {
                        if (!reader.Read()) return "{\"found\":false}";

                        result.Append("{\"found\":true,\"patient\":{");
                        result.Append("\"regno\":").Append(Convert.ToInt64(reader["RegNo"], CultureInfo.InvariantCulture));
                        result.Append(",\"first_name\":").Append(JsonString(reader["FirstName"]));
                        result.Append(",\"last_name\":").Append(JsonString(reader["LastName"]));
                        result.Append(",\"age\":").Append(JsonNumber(reader["Age"]));
                        result.Append(",\"gender\":").Append(JsonString(reader["Gender"]));
                        result.Append(",\"address\":").Append(JsonString(reader["Address"]));
                        result.Append(",\"first_visit\":").Append(JsonDate(reader["FirstVisit"]));
                        result.Append("}");
                    }
                }

                result.Append(",\"prescriptions\":[");
                using (OleDbCommand command = new OleDbCommand(
                    "SELECT [Prescription],[PrescriptionDate] FROM [Prescription] WHERE [RegNo]=? " +
                    "ORDER BY [PrescriptionDate]", connection))
                {
                    command.Parameters.Add("@RegNo", OleDbType.Integer).Value = (int)regNo;
                    using (OleDbDataReader reader = command.ExecuteReader())
                    {
                        bool first = true;
                        while (reader.Read())
                        {
                            if (!first) result.Append(",");
                            first = false;
                            result.Append("{\"text\":").Append(JsonString(reader["Prescription"]));
                            result.Append(",\"date\":").Append(JsonDate(reader["PrescriptionDate"]));
                            result.Append("}");
                        }
                    }
                }
                result.Append("]}");
                return result.ToString();
            }
        }

        private static string JsonString(object value)
        {
            if (value == null || value == DBNull.Value) return "null";
            string text = Convert.ToString(value, CultureInfo.InvariantCulture);
            StringBuilder builder = new StringBuilder("\"");
            foreach (char current in text)
            {
                if (current == '"') builder.Append("\\\"");
                else if (current == '\\') builder.Append("\\\\");
                else if (current == '\n') builder.Append("\\n");
                else if (current == '\r') builder.Append("\\r");
                else if (current == '\t') builder.Append("\\t");
                else if (current < ' ') builder.Append("\\u").Append(((int)current).ToString("x4", CultureInfo.InvariantCulture));
                else builder.Append(current);
            }
            return builder.Append("\"").ToString();
        }

        private static string JsonNumber(object value)
        {
            if (value == null || value == DBNull.Value) return "null";
            return Convert.ToInt64(value, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture);
        }

        private static string JsonDate(object value)
        {
            if (value == null || value == DBNull.Value) return "null";
            DateTime date = Convert.ToDateTime(value, CultureInfo.InvariantCulture);
            return "\"" + date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "\"";
        }

        private static PendingResponse DownloadPending(string apiUrl)
        {
            using (TimeoutWebClient client = new TimeoutWebClient())
            {
                client.Encoding = Encoding.UTF8;
                string json = client.DownloadString(apiUrl + "/api/pis/pending?clinic_id=" + ClinicId);
                return ReadPendingResponse(json);
            }
        }

        private static PendingResponse ReadPendingResponse(string json)
        {
            Dictionary<string, object> root = SimpleJson.Parse(json) as Dictionary<string, object>;
            if (root == null) throw new InvalidOperationException("ClinicClick returned invalid data.");

            PendingResponse response = new PendingResponse();
            response.Jobs = new List<ImportJob>();

            List<object> jobs = GetArray(root, "jobs", true);
            for (int i = 0; i < jobs.Count; i++)
            {
                Dictionary<string, object> item = jobs[i] as Dictionary<string, object>;
                if (item == null) throw new InvalidOperationException("ClinicClick returned invalid job data.");

                ImportJob job = new ImportJob();
                job.Id = GetString(item, "id", true);
                job.Status = GetString(item, "status", true);
                job.Patient = ReadPatient(GetObject(item, "patient", true));
                job.Prescriptions = ReadPrescriptions(GetArray(item, "prescriptions", false));
                response.Jobs.Add(job);
            }
            return response;
        }

        private static PatientData ReadPatient(Dictionary<string, object> item)
        {
            PatientData patient = new PatientData();
            patient.FirstName = GetString(item, "first_name", true);
            patient.LastName = GetString(item, "last_name", false);
            patient.Age = GetInt(item, "age");
            patient.Gender = GetString(item, "gender", true);
            patient.Address = GetString(item, "address", false);
            patient.FirstVisit = GetString(item, "first_visit", true);
            return patient;
        }

        private static List<PrescriptionData> ReadPrescriptions(List<object> items)
        {
            List<PrescriptionData> prescriptions = new List<PrescriptionData>();
            if (items == null) return prescriptions;
            for (int i = 0; i < items.Count; i++)
            {
                Dictionary<string, object> item = items[i] as Dictionary<string, object>;
                if (item == null) throw new InvalidOperationException("ClinicClick returned invalid prescription data.");
                PrescriptionData prescription = new PrescriptionData();
                prescription.Text = GetString(item, "text", true);
                prescription.Date = GetString(item, "date", true);
                prescriptions.Add(prescription);
            }
            return prescriptions;
        }

        private static void TryAcknowledge(string apiUrl, string jobId)
        {
            try
            {
                using (TimeoutWebClient client = new TimeoutWebClient())
                {
                    client.Headers[HttpRequestHeader.ContentType] = "application/json";
                    client.UploadString(apiUrl + "/api/pis/jobs/" + Uri.EscapeDataString(jobId) + "/ack", "POST", "{}");
                }
            }
            catch
            {
                // The local idempotency table prevents duplicates. A future click
                // will retry acknowledgement if the network failed after commit.
            }
        }

        private static Dictionary<string, object> GetObject(Dictionary<string, object> values, string key, bool required)
        {
            object value;
            if (!values.TryGetValue(key, out value) || value == null)
            {
                if (required) throw new InvalidOperationException("ClinicClick response is missing " + key + ".");
                return null;
            }
            Dictionary<string, object> result = value as Dictionary<string, object>;
            if (result == null) throw new InvalidOperationException("ClinicClick response has invalid " + key + ".");
            return result;
        }

        private static List<object> GetArray(Dictionary<string, object> values, string key, bool required)
        {
            object value;
            if (!values.TryGetValue(key, out value) || value == null)
            {
                if (required) throw new InvalidOperationException("ClinicClick response is missing " + key + ".");
                return null;
            }
            List<object> result = value as List<object>;
            if (result == null) throw new InvalidOperationException("ClinicClick response has invalid " + key + ".");
            return result;
        }

        private static string GetString(Dictionary<string, object> values, string key, bool required)
        {
            object value;
            if (!values.TryGetValue(key, out value) || value == null)
            {
                if (required) throw new InvalidOperationException("ClinicClick response is missing " + key + ".");
                return "";
            }
            string result = value as string;
            if (result == null) throw new InvalidOperationException("ClinicClick response has invalid " + key + ".");
            return result;
        }

        private static int GetInt(Dictionary<string, object> values, string key)
        {
            object value;
            if (!values.TryGetValue(key, out value) || value == null)
                throw new InvalidOperationException("ClinicClick response is missing " + key + ".");
            if (value is int) return (int)value;
            if (value is long) return Convert.ToInt32((long)value, CultureInfo.InvariantCulture);
            throw new InvalidOperationException("ClinicClick response has invalid " + key + ".");
        }

        private static void ImportOne(OleDbConnection connection, ImportJob job)
        {
            // The Jet 4.0 provider rejects Serializable; its default level still
            // gives atomic commit/rollback for the patient + prescription batch.
            using (OleDbTransaction transaction = connection.BeginTransaction())
            {
                try
                {
                    int regNo = InsertPatient(connection, transaction, job.Patient);
                    if (job.Prescriptions != null)
                    {
                        foreach (PrescriptionData prescription in job.Prescriptions)
                            InsertPrescription(connection, transaction, regNo, prescription);
                    }
                    MarkImported(connection, transaction, job.Id, regNo);
                    transaction.Commit();
                }
                catch
                {
                    try { transaction.Rollback(); } catch { }
                    throw;
                }
            }
        }

        private static int InsertPatient(OleDbConnection connection, OleDbTransaction transaction, PatientData patient)
        {
            const string sql = "INSERT INTO [Patient] " +
                "([FirstName],[LastName],[Age],[Address],[FirstVisit],[Gender]) VALUES (?,?,?,?,?,?)";
            using (OleDbCommand command = new OleDbCommand(sql, connection, transaction))
            {
                AddText(command, patient.FirstName, 255);
                AddText(command, patient.LastName, 255);
                command.Parameters.Add("@Age", OleDbType.Integer).Value = patient.Age;
                AddText(command, patient.Address, 255);
                command.Parameters.Add("@FirstVisit", OleDbType.Date).Value = ParseDate(patient.FirstVisit);
                AddText(command, patient.Gender, 1);
                if (command.ExecuteNonQuery() != 1) throw new InvalidOperationException("Patient insert failed.");
            }
            using (OleDbCommand identity = new OleDbCommand("SELECT @@IDENTITY", connection, transaction))
                return Convert.ToInt32(identity.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        private static void InsertPrescription(OleDbConnection connection, OleDbTransaction transaction,
            int regNo, PrescriptionData prescription)
        {
            const string sql = "INSERT INTO [Prescription] ([RegNo],[Prescription],[PrescriptionDate]) VALUES (?,?,?)";
            using (OleDbCommand command = new OleDbCommand(sql, connection, transaction))
            {
                command.Parameters.Add("@RegNo", OleDbType.Integer).Value = regNo;
                AddText(command, prescription.Text, 255);
                command.Parameters.Add("@PrescriptionDate", OleDbType.Date).Value = ParseDate(prescription.Date);
                if (command.ExecuteNonQuery() != 1) throw new InvalidOperationException("Prescription insert failed.");
            }
        }

        private static void ValidateDemoJob(ImportJob job)
        {
            if (job == null || String.IsNullOrEmpty(job.Id)) throw new InvalidOperationException("Invalid job id.");
            if (job.Status != "approved") throw new InvalidOperationException("Only approved jobs can be imported.");
            if (job.Patient == null) throw new InvalidOperationException("Patient data is missing.");
            string identity = ((job.Patient.FirstName ?? "") + " " + (job.Patient.LastName ?? "")).ToUpperInvariant();
            if (identity.IndexOf("APPDEMO", StringComparison.Ordinal) < 0)
                throw new InvalidOperationException("Demo PIS accepts only APPDEMO patients.");
            if (job.Patient.Age < 0 || job.Patient.Age > 130) throw new InvalidOperationException("Invalid age.");
            if (job.Patient.Gender != "M" && job.Patient.Gender != "F") throw new InvalidOperationException("Invalid gender.");
            RequireLength(job.Patient.FirstName, 1, 255, "first name");
            RequireLength(job.Patient.LastName, 0, 255, "last name");
            RequireLength(job.Patient.Address, 0, 255, "address");
            ParseDate(job.Patient.FirstVisit);
            if (job.Prescriptions != null)
            {
                foreach (PrescriptionData prescription in job.Prescriptions)
                {
                    RequireLength(prescription.Text, 1, 255, "prescription");
                    if (!prescription.Text.StartsWith("DEMO", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Demo prescription must begin with DEMO.");
                    ParseDate(prescription.Date);
                }
            }
        }

        private static void EnsureBackup(string databasePath)
        {
            string backupDirectory = Path.Combine(Application.StartupPath, "ClinicClickBackups");
            Directory.CreateDirectory(backupDirectory);
            if (Directory.GetFiles(backupDirectory, "Homeopathy-before-import-*.mdb").Length > 0) return;
            string backup = Path.Combine(backupDirectory,
                "Homeopathy-before-import-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".mdb");
            File.Copy(databasePath, backup, false);
        }

        private static void EnsureImportTable(OleDbConnection connection)
        {
            DataTable table = connection.GetOleDbSchemaTable(OleDbSchemaGuid.Tables,
                new object[] { null, null, "ClinicClickImport", "TABLE" });
            if (table != null && table.Rows.Count > 0) return;
            const string ddl = "CREATE TABLE [ClinicClickImport] (" +
                "[JobId] TEXT(100) NOT NULL, [RegNo] LONG NOT NULL, [ImportedAt] DATETIME NOT NULL, " +
                "CONSTRAINT [PK_ClinicClickImport] PRIMARY KEY ([JobId]))";
            using (OleDbCommand command = new OleDbCommand(ddl, connection)) command.ExecuteNonQuery();
        }

        private static bool WasImported(OleDbConnection connection, string jobId)
        {
            using (OleDbCommand command = new OleDbCommand(
                "SELECT COUNT(*) FROM [ClinicClickImport] WHERE [JobId]=?", connection))
            {
                AddText(command, jobId, 100);
                return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture) > 0;
            }
        }

        private static void MarkImported(OleDbConnection connection, OleDbTransaction transaction,
            string jobId, int regNo)
        {
            using (OleDbCommand command = new OleDbCommand(
                "INSERT INTO [ClinicClickImport] ([JobId],[RegNo],[ImportedAt]) VALUES (?,?,?)", connection, transaction))
            {
                AddText(command, jobId, 100);
                command.Parameters.Add("@RegNo", OleDbType.Integer).Value = regNo;
                command.Parameters.Add("@ImportedAt", OleDbType.Date).Value = DateTime.Now;
                command.ExecuteNonQuery();
            }
        }

        private static void RefreshPatientGrid(Form host)
        {
            FieldInfo patientDataField = host.GetType().GetField("patientData",
                BindingFlags.Instance | BindingFlags.NonPublic);
            if (patientDataField != null)
            {
                DataSet patientData = patientDataField.GetValue(host) as DataSet;
                if (patientData != null) patientData.Clear();
            }
            MethodInfo refresh = host.GetType().GetMethod("refreshPatientData",
                BindingFlags.Instance | BindingFlags.NonPublic);
            if (refresh != null) refresh.Invoke(host, null);
        }

        private static T FindControl<T>(Control parent) where T : Control
        {
            foreach (Control child in parent.Controls)
            {
                T match = child as T;
                if (match != null) return match;
                match = FindControl<T>(child);
                if (match != null) return match;
            }
            return null;
        }

        private static DateTime ParseDate(string value)
        {
            DateTime result;
            if (!DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out result)) throw new InvalidOperationException("Invalid date from app.");
            return result;
        }

        private static void RequireLength(string value, int minimum, int maximum, string field)
        {
            int length = value == null ? 0 : value.Length;
            if (length < minimum || length > maximum) throw new InvalidOperationException("Invalid " + field + ".");
        }

        private static void AddText(OleDbCommand command, string value, int length)
        {
            OleDbParameter parameter = command.Parameters.Add("@Text", OleDbType.VarWChar, length);
            parameter.Value = value ?? "";
        }

        private static string ConnectionString(string databasePath)
        {
            return "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=" + databasePath + ";Persist Security Info=False;";
        }
    }
}
