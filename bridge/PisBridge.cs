using System;
using System.Collections.Generic;
using System.Data;
using System.Data.OleDb;
using System.Globalization;
using System.IO;
using System.Net;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;

namespace ClinicClick.PisBridge
{
    [DataContract]
    public sealed class ApplyJob
    {
        [DataMember(Name = "job_id")]
        public string JobId;

        [DataMember(Name = "status")]
        public string Status;

        [DataMember(Name = "patient")]
        public PatientInput Patient;

        [DataMember(Name = "existing_reg_no")]
        public int? ExistingRegNo;

        [DataMember(Name = "prescriptions")]
        public List<PrescriptionInput> Prescriptions;
    }

    [DataContract]
    public sealed class PatientInput
    {
        [DataMember(Name = "first_name")]
        public string FirstName;

        [DataMember(Name = "last_name")]
        public string LastName;

        [DataMember(Name = "age")]
        public int Age;

        [DataMember(Name = "address")]
        public string Address;

        [DataMember(Name = "first_visit")]
        public string FirstVisit;

        [DataMember(Name = "gender")]
        public string Gender;
    }

    [DataContract]
    public sealed class PrescriptionInput
    {
        [DataMember(Name = "text")]
        public string Text;

        [DataMember(Name = "date")]
        public string Date;
    }

    [DataContract]
    public sealed class ApiResponse
    {
        [DataMember(Name = "ok")]
        public bool Ok;

        [DataMember(Name = "job_id", EmitDefaultValue = false)]
        public string JobId;

        [DataMember(Name = "reg_no", EmitDefaultValue = false)]
        public int RegNo;

        [DataMember(Name = "prescriptions_added", EmitDefaultValue = false)]
        public int PrescriptionsAdded;

        [DataMember(Name = "idempotent_replay", EmitDefaultValue = false)]
        public bool IdempotentReplay;

        [DataMember(Name = "error", EmitDefaultValue = false)]
        public string Error;
    }

    public sealed class BridgeOptions
    {
        public string DatabasePath;
        public string Token;
        public int Port = 8765;
        public bool DemoOnly = true;
        public bool InstallSchema;
        public bool SelfTest;
    }

    public static class Program
    {
        private const int MaxRequestBytes = 65536;
        private static readonly object ApplyLock = new object();

        public static int Main(string[] args)
        {
            try
            {
                BridgeOptions options = ParseOptions(args);
                if (options.SelfTest)
                {
                    RunSelfTest();
                    Console.WriteLine("Self-test passed.");
                    return 0;
                }

                Require(!String.IsNullOrEmpty(options.DatabasePath), "--db is required");
                options.DatabasePath = Path.GetFullPath(options.DatabasePath);
                Require(File.Exists(options.DatabasePath), "Database not found: " + options.DatabasePath);
                Require(!String.IsNullOrEmpty(options.Token) && options.Token.Length >= 24,
                    "--token must contain at least 24 characters");

                if (options.InstallSchema)
                {
                    InstallBridgeSchema(options);
                    return 0;
                }

                RunServer(options);
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Fatal: " + ex.Message);
                return 1;
            }
        }

        private static BridgeOptions ParseOptions(string[] args)
        {
            BridgeOptions options = new BridgeOptions();
            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i];
                if (arg == "--self-test") options.SelfTest = true;
                else if (arg == "--install-schema") options.InstallSchema = true;
                else if (arg == "--allow-production") options.DemoOnly = false;
                else if (arg == "--db" && i + 1 < args.Length) options.DatabasePath = args[++i];
                else if (arg == "--token" && i + 1 < args.Length) options.Token = args[++i];
                else if (arg == "--port" && i + 1 < args.Length) options.Port = Int32.Parse(args[++i], CultureInfo.InvariantCulture);
                else throw new ArgumentException("Unknown or incomplete option: " + arg);
            }
            Require(options.Port >= 1024 && options.Port <= 65535, "Port must be between 1024 and 65535");
            return options;
        }

        private static void RunServer(BridgeOptions options)
        {
            string prefix = "http://127.0.0.1:" + options.Port.ToString(CultureInfo.InvariantCulture) + "/";
            HttpListener listener = new HttpListener();
            listener.Prefixes.Add(prefix);
            listener.Start();
            Console.WriteLine("ClinicClick PIS Bridge listening on " + prefix);
            Console.WriteLine("Database: " + options.DatabasePath);
            Console.WriteLine("Mode: " + (options.DemoOnly ? "DEMO ONLY" : "PRODUCTION"));

            while (true)
            {
                HttpListenerContext context = listener.GetContext();
                try
                {
                    HandleRequest(context, options);
                }
                catch (Exception ex)
                {
                    WriteJson(context.Response, 500, new ApiResponse { Ok = false, Error = ex.Message });
                    Audit(options, "request_failed", null, ex.Message);
                }
            }
        }

        private static void HandleRequest(HttpListenerContext context, BridgeOptions options)
        {
            string path = context.Request.Url.AbsolutePath.TrimEnd('/');
            if (context.Request.HttpMethod == "GET" && path == "/health")
            {
                WriteJson(context.Response, 200, new ApiResponse { Ok = true });
                return;
            }

            if (context.Request.HttpMethod != "POST" || path != "/v1/jobs/apply")
            {
                WriteJson(context.Response, 404, new ApiResponse { Ok = false, Error = "Not found" });
                return;
            }

            string authorization = context.Request.Headers["Authorization"];
            string expected = "Bearer " + options.Token;
            if (!ConstantTimeEquals(authorization, expected))
            {
                WriteJson(context.Response, 401, new ApiResponse { Ok = false, Error = "Unauthorized" });
                return;
            }

            ApplyJob job;
            try
            {
                job = ReadJson<ApplyJob>(context.Request);
                ValidateJob(job, options.DemoOnly);
            }
            catch (Exception ex)
            {
                WriteJson(context.Response, 400, new ApiResponse { Ok = false, Error = ex.Message });
                return;
            }

            ApiResponse result;
            lock (ApplyLock)
            {
                result = ApplyApprovedJob(options, job);
            }
            WriteJson(context.Response, 200, result);
        }

        private static ApiResponse ApplyApprovedJob(BridgeOptions options, ApplyJob job)
        {
            using (OleDbConnection connection = new OleDbConnection(ConnectionString(options.DatabasePath)))
            {
                connection.Open();
                using (OleDbTransaction transaction = connection.BeginTransaction(IsolationLevel.Serializable))
                {
                    try
                    {
                        int existingJobRegNo;
                        if (TryGetAppliedJob(connection, transaction, job.JobId, out existingJobRegNo))
                        {
                            transaction.Rollback();
                            return new ApiResponse
                            {
                                Ok = true,
                                JobId = job.JobId,
                                RegNo = existingJobRegNo,
                                IdempotentReplay = true
                            };
                        }

                        int regNo;
                        if (job.Patient != null)
                            regNo = InsertPatient(connection, transaction, job.Patient);
                        else
                        {
                            regNo = job.ExistingRegNo.Value;
                            Require(PatientExists(connection, transaction, regNo), "Existing patient was not found");
                            if (options.DemoOnly)
                                Require(PatientIsDemo(connection, transaction, regNo),
                                    "Demo-only mode can modify only a TEST or DEMO patient");
                        }

                        int prescriptionCount = 0;
                        if (job.Prescriptions != null)
                        {
                            foreach (PrescriptionInput prescription in job.Prescriptions)
                            {
                                InsertPrescription(connection, transaction, regNo, prescription);
                                prescriptionCount++;
                            }
                        }

                        MarkJobApplied(connection, transaction, job.JobId, regNo);
                        transaction.Commit();
                        Audit(options, "job_applied", job.JobId,
                            "reg_no=" + regNo.ToString(CultureInfo.InvariantCulture) +
                            ";prescriptions=" + prescriptionCount.ToString(CultureInfo.InvariantCulture));
                        return new ApiResponse
                        {
                            Ok = true,
                            JobId = job.JobId,
                            RegNo = regNo,
                            PrescriptionsAdded = prescriptionCount
                        };
                    }
                    catch
                    {
                        try { transaction.Rollback(); } catch { }
                        throw;
                    }
                }
            }
        }

        private static int InsertPatient(OleDbConnection connection, OleDbTransaction transaction, PatientInput patient)
        {
            const string sql = "INSERT INTO [Patient] " +
                "([FirstName],[LastName],[Age],[Address],[FirstVisit],[Gender]) VALUES (?,?,?,?,?,?)";
            using (OleDbCommand command = new OleDbCommand(sql, connection, transaction))
            {
                AddText(command, patient.FirstName, 255);
                AddText(command, patient.LastName ?? "", 255);
                command.Parameters.Add("@Age", OleDbType.Integer).Value = patient.Age;
                AddText(command, patient.Address ?? "", 255);
                command.Parameters.Add("@FirstVisit", OleDbType.Date).Value = ParseDate(patient.FirstVisit, "first_visit");
                AddText(command, patient.Gender.ToUpperInvariant(), 1);
                Require(command.ExecuteNonQuery() == 1, "Patient insert did not affect exactly one row");
            }
            return ReadIdentity(connection, transaction);
        }

        private static void InsertPrescription(OleDbConnection connection, OleDbTransaction transaction,
            int regNo, PrescriptionInput prescription)
        {
            const string sql = "INSERT INTO [Prescription] ([RegNo],[Prescription],[PrescriptionDate]) VALUES (?,?,?)";
            using (OleDbCommand command = new OleDbCommand(sql, connection, transaction))
            {
                command.Parameters.Add("@RegNo", OleDbType.Integer).Value = regNo;
                AddText(command, prescription.Text, 255);
                command.Parameters.Add("@PrescriptionDate", OleDbType.Date).Value = ParseDate(prescription.Date, "prescription date");
                Require(command.ExecuteNonQuery() == 1, "Prescription insert did not affect exactly one row");
            }
        }

        private static int ReadIdentity(OleDbConnection connection, OleDbTransaction transaction)
        {
            using (OleDbCommand command = new OleDbCommand("SELECT @@IDENTITY", connection, transaction))
            {
                object value = command.ExecuteScalar();
                return Convert.ToInt32(value, CultureInfo.InvariantCulture);
            }
        }

        private static bool PatientExists(OleDbConnection connection, OleDbTransaction transaction, int regNo)
        {
            using (OleDbCommand command = new OleDbCommand("SELECT COUNT(*) FROM [Patient] WHERE [RegNo]=?", connection, transaction))
            {
                command.Parameters.Add("@RegNo", OleDbType.Integer).Value = regNo;
                return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
            }
        }

        private static bool PatientIsDemo(OleDbConnection connection, OleDbTransaction transaction, int regNo)
        {
            using (OleDbCommand command = new OleDbCommand(
                "SELECT [FirstName],[LastName] FROM [Patient] WHERE [RegNo]=?", connection, transaction))
            {
                command.Parameters.Add("@RegNo", OleDbType.Integer).Value = regNo;
                using (OleDbDataReader reader = command.ExecuteReader())
                {
                    if (!reader.Read()) return false;
                    string identity = (Convert.ToString(reader[0], CultureInfo.InvariantCulture) + " " +
                        Convert.ToString(reader[1], CultureInfo.InvariantCulture)).ToUpperInvariant();
                    return identity.IndexOf("TEST", StringComparison.Ordinal) >= 0 ||
                        identity.IndexOf("DEMO", StringComparison.Ordinal) >= 0;
                }
            }
        }

        private static bool TryGetAppliedJob(OleDbConnection connection, OleDbTransaction transaction,
            string jobId, out int regNo)
        {
            using (OleDbCommand command = new OleDbCommand(
                "SELECT [RegNo] FROM [ClinicClickJob] WHERE [JobId]=?", connection, transaction))
            {
                AddText(command, jobId, 100);
                object value = command.ExecuteScalar();
                if (value == null || value == DBNull.Value)
                {
                    regNo = 0;
                    return false;
                }
                regNo = Convert.ToInt32(value, CultureInfo.InvariantCulture);
                return true;
            }
        }

        private static void MarkJobApplied(OleDbConnection connection, OleDbTransaction transaction,
            string jobId, int regNo)
        {
            using (OleDbCommand command = new OleDbCommand(
                "INSERT INTO [ClinicClickJob] ([JobId],[RegNo],[AppliedAt]) VALUES (?,?,?)", connection, transaction))
            {
                AddText(command, jobId, 100);
                command.Parameters.Add("@RegNo", OleDbType.Integer).Value = regNo;
                command.Parameters.Add("@AppliedAt", OleDbType.Date).Value = DateTime.UtcNow;
                Require(command.ExecuteNonQuery() == 1, "Could not record job idempotency marker");
            }
        }

        private static void InstallBridgeSchema(BridgeOptions options)
        {
            string backupDirectory = Path.Combine(Path.GetDirectoryName(options.DatabasePath), "ClinicClickBackups");
            Directory.CreateDirectory(backupDirectory);
            string backupPath = Path.Combine(backupDirectory,
                "Homeopathy-before-bridge-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".mdb");
            File.Copy(options.DatabasePath, backupPath, false);
            Console.WriteLine("Backup created: " + backupPath);

            using (OleDbConnection connection = new OleDbConnection(ConnectionString(options.DatabasePath)))
            {
                connection.Open();
                if (TableExists(connection, "ClinicClickJob"))
                {
                    Console.WriteLine("ClinicClickJob table already exists; nothing changed.");
                    return;
                }
                const string ddl = "CREATE TABLE [ClinicClickJob] (" +
                    "[JobId] TEXT(100) NOT NULL, [RegNo] LONG NOT NULL, [AppliedAt] DATETIME NOT NULL, " +
                    "CONSTRAINT [PK_ClinicClickJob] PRIMARY KEY ([JobId]))";
                using (OleDbCommand command = new OleDbCommand(ddl, connection))
                    command.ExecuteNonQuery();
            }
            Console.WriteLine("ClinicClickJob idempotency table installed.");
        }

        private static bool TableExists(OleDbConnection connection, string tableName)
        {
            DataTable schema = connection.GetOleDbSchemaTable(OleDbSchemaGuid.Tables,
                new object[] { null, null, tableName, "TABLE" });
            return schema != null && schema.Rows.Count > 0;
        }

        public static void ValidateJob(ApplyJob job, bool demoOnly)
        {
            Require(job != null, "JSON body is required");
            Require(!String.IsNullOrEmpty(job.JobId) && job.JobId.Length <= 100, "job_id is required and must be <= 100 characters");
            Require(job.Status == "approved", "status must be approved");
            Require((job.Patient != null) != job.ExistingRegNo.HasValue,
                "Provide exactly one of patient or existing_reg_no");

            if (job.Patient != null)
            {
                RequireText(job.Patient.FirstName, "first_name", 255);
                Require(job.Patient.LastName == null || job.Patient.LastName.Length <= 255, "last_name is too long");
                Require(job.Patient.Age >= 0 && job.Patient.Age <= 130, "age must be between 0 and 130");
                Require(job.Patient.Address == null || job.Patient.Address.Length <= 255, "address is too long");
                Require(job.Patient.Gender == "M" || job.Patient.Gender == "F", "gender must be M or F");
                ParseDate(job.Patient.FirstVisit, "first_visit");
                if (demoOnly)
                {
                    string identity = (job.Patient.FirstName + " " + (job.Patient.LastName ?? "")).ToUpperInvariant();
                    Require(identity.IndexOf("TEST", StringComparison.Ordinal) >= 0 ||
                        identity.IndexOf("DEMO", StringComparison.Ordinal) >= 0,
                        "Demo-only mode requires TEST or DEMO in the patient name");
                }
            }
            else
            {
                Require(job.ExistingRegNo.Value > 0, "existing_reg_no must be positive");
                Require(job.Prescriptions != null && job.Prescriptions.Count > 0,
                    "An existing-patient job must add at least one prescription");
            }

            if (job.Prescriptions != null)
            {
                Require(job.Prescriptions.Count <= 20, "At most 20 prescriptions are allowed per job");
                foreach (PrescriptionInput prescription in job.Prescriptions)
                {
                    Require(prescription != null, "Prescription entry cannot be null");
                    RequireText(prescription.Text, "prescription text", 255);
                    ParseDate(prescription.Date, "prescription date");
                    if (demoOnly)
                        Require(prescription.Text.StartsWith("DEMO", StringComparison.OrdinalIgnoreCase),
                            "Demo prescription text must begin with DEMO");
                }
            }
        }

        private static DateTime ParseDate(string value, string field)
        {
            DateTime parsed;
            Require(DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out parsed), field + " must use yyyy-MM-dd");
            return parsed;
        }

        private static void RequireText(string value, string field, int maxLength)
        {
            Require(!String.IsNullOrEmpty(value), field + " is required");
            Require(value.Length <= maxLength, field + " is too long");
        }

        private static void AddText(OleDbCommand command, string value, int length)
        {
            OleDbParameter parameter = command.Parameters.Add("@Text", OleDbType.VarWChar, length);
            parameter.Value = value;
        }

        private static string ConnectionString(string databasePath)
        {
            return "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=" + databasePath + ";Persist Security Info=False;";
        }

        private static T ReadJson<T>(HttpListenerRequest request)
        {
            Require(request.ContentLength64 >= 0 && request.ContentLength64 <= MaxRequestBytes,
                "Request body is too large");
            DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(T));
            return (T)serializer.ReadObject(request.InputStream);
        }

        private static void WriteJson(HttpListenerResponse response, int statusCode, object value)
        {
            response.StatusCode = statusCode;
            response.ContentType = "application/json; charset=utf-8";
            DataContractJsonSerializer serializer = new DataContractJsonSerializer(value.GetType());
            using (MemoryStream memory = new MemoryStream())
            {
                serializer.WriteObject(memory, value);
                byte[] bytes = memory.ToArray();
                response.ContentLength64 = bytes.Length;
                response.OutputStream.Write(bytes, 0, bytes.Length);
            }
            response.OutputStream.Close();
        }

        private static bool ConstantTimeEquals(string left, string right)
        {
            if (left == null) left = "";
            if (right == null) right = "";
            byte[] leftHash;
            byte[] rightHash;
            using (SHA256 sha = SHA256.Create())
            {
                leftHash = sha.ComputeHash(Encoding.UTF8.GetBytes(left));
                rightHash = sha.ComputeHash(Encoding.UTF8.GetBytes(right));
            }
            int difference = 0;
            for (int i = 0; i < leftHash.Length; i++) difference |= leftHash[i] ^ rightHash[i];
            return difference == 0;
        }

        private static void Audit(BridgeOptions options, string action, string jobId, string detail)
        {
            string directory = Path.Combine(Path.GetDirectoryName(options.DatabasePath), "ClinicClickAudit");
            Directory.CreateDirectory(directory);
            string line = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + "\t" + action + "\t" +
                (jobId ?? "-") + "\t" + detail.Replace("\r", " ").Replace("\n", " ") + Environment.NewLine;
            File.AppendAllText(Path.Combine(directory, "bridge-audit.log"), line, Encoding.UTF8);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static void RunSelfTest()
        {
            ApplyJob valid = new ApplyJob
            {
                JobId = "self-test-1",
                Status = "approved",
                Patient = new PatientInput
                {
                    FirstName = "TEST",
                    LastName = "BRIDGE",
                    Age = 30,
                    Address = "DEMO ONLY",
                    FirstVisit = "2026-07-04",
                    Gender = "M"
                },
                Prescriptions = new List<PrescriptionInput>
                {
                    new PrescriptionInput { Text = "DEMO ONLY - NOT FOR TREATMENT", Date = "2026-07-04" }
                }
            };
            ValidateJob(valid, true);

            bool rejected = false;
            valid.Patient.FirstName = "REAL";
            try { ValidateJob(valid, true); }
            catch (InvalidOperationException) { rejected = true; }
            Require(rejected, "Demo-only validation did not reject a non-demo patient");

            ApplyJob existingDemo = new ApplyJob
            {
                JobId = "self-test-existing-1",
                Status = "approved",
                ExistingRegNo = 123,
                Prescriptions = new List<PrescriptionInput>
                {
                    new PrescriptionInput { Text = "DEMO FOLLOW-UP", Date = "2026-07-04" }
                }
            };
            ValidateJob(existingDemo, true);
        }
    }
}
